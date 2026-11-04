const defaultFirebaseConfig = {
  projectId: 'clean-striker-r9v0l',
  appId: '1:603858171718:web:c47ccc94c8ace919669747',
  apiKey: 'AIzaSyDwNOJbHHNsfJPHEs-pBVqAXhgnMXzfm74',
  authDomain: 'clean-striker-r9v0l.firebaseapp.com',
  firestoreDatabaseId: 'ai-studio-gaworkspacegrowt-800706db-ad9e-4c45-9fd5-b7cfb2abdddf',
  storageBucket: 'clean-striker-r9v0l.firebasestorage.app',
  messagingSenderId: '603858171718',
};

export const PRIMARY_SUPER_ADMIN_EMAIL = 'hammad@growthalliance.net';
export const BOOTSTRAP_ADMIN_EMAILS = [
  'hammad@growthalliance.net',
  'hammadkhanniaxii@gmail.com',
];

export function getFirebaseConfig(env?: Record<string, any>) {
  return {
    projectId: env?.FIREBASE_PROJECT_ID || defaultFirebaseConfig.projectId,
    apiKey: env?.FIREBASE_API_KEY || defaultFirebaseConfig.apiKey,
    firestoreDatabaseId: env?.FIREBASE_FIRESTORE_DATABASE_ID || defaultFirebaseConfig.firestoreDatabaseId,
  };
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders,
    },
  });
}

export function serializeToFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(serializeToFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = serializeToFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function deserializeFirestoreValue(val: any): any {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return val.doubleValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(deserializeFirestoreValue);
  }
  if ('mapValue' in val) {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.mapValue?.fields || {})) {
      res[k] = deserializeFirestoreValue(v);
    }
    return res;
  }
  return null;
}

export function deserializeFirestoreDoc(docItem: any): any {
  if (!docItem || !docItem.fields) return null;
  const nameParts = (docItem.name || '').split('/');
  const docId = nameParts[nameParts.length - 1];
  const obj: Record<string, any> = { id: docId };
  for (const [key, val] of Object.entries(docItem.fields)) {
    obj[key] = deserializeFirestoreValue(val);
  }
  return obj;
}

export async function writeFirestoreDoc(
  pathDoc: string,
  fields: Record<string, any>,
  idToken: string,
  env?: Record<string, any>
) {
  const cfg = getFirebaseConfig(env);
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents/${pathDoc}`;
  const firestoreFields: Record<string, any> = {};

  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) {
      firestoreFields[key] = serializeToFirestoreValue(val);
    }
  }

  const fieldKeys = Object.keys(firestoreFields);
  const maskQuery = fieldKeys.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const url = maskQuery ? `${baseUrl}?${maskQuery}` : baseUrl;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fields: firestoreFields }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Failed to write Firestore doc ${pathDoc}:`, errText);
    throw new Error(`Firestore write failed for ${pathDoc}: ${errText}`);
  }
  return await res.json();
}

export async function readFirestoreDoc(
  pathDoc: string,
  idToken: string,
  env?: Record<string, any>
): Promise<any | null> {
  try {
    const cfg = getFirebaseConfig(env);
    const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents/${pathDoc}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    return deserializeFirestoreDoc(data);
  } catch (e) {
    console.warn(`Error reading Firestore doc ${pathDoc}:`, e);
    return null;
  }
}

export async function deleteFirestoreDoc(
  pathDoc: string,
  idToken: string,
  env?: Record<string, any>
): Promise<boolean> {
  try {
    const cfg = getFirebaseConfig(env);
    const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents/${pathDoc}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    return res.ok;
  } catch (e) {
    console.warn(`Error deleting Firestore doc ${pathDoc}:`, e);
    return false;
  }
}

export async function verifyAdminCaller(
  request: Request,
  env?: Record<string, any>
): Promise<{
  authorized: boolean;
  error?: string;
  adminEmail?: string;
  adminUid?: string;
  idToken?: string;
  isSuperAdmin?: boolean;
}> {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authorized: false, error: 'Authentication required. Missing Bearer authorization token.' };
  }
  const idToken = authHeader.split('Bearer ')[1].trim();
  if (!idToken) {
    return { authorized: false, error: 'Empty authorization token provided.' };
  }

  try {
    const cfg = getFirebaseConfig(env);
    const lookupUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${cfg.apiKey}`;
    const lookupRes = await fetch(lookupUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const lookupData: any = await lookupRes.json();
    if (!lookupRes.ok || !lookupData.users || lookupData.users.length === 0) {
      return { authorized: false, error: 'Invalid or expired administrative session. Please sign in again.' };
    }

    const caller = lookupData.users[0];
    const callerEmail = (caller.email || '').toLowerCase().trim();
    const callerUid = caller.localId;

    if (callerEmail === PRIMARY_SUPER_ADMIN_EMAIL.toLowerCase() || callerEmail === 'hammadkhanniaxii@gmail.com') {
      return {
        authorized: true,
        adminEmail: callerEmail,
        adminUid: callerUid,
        idToken,
        isSuperAdmin: true,
      };
    }

    const adminDocUrl = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents/admins/${callerUid}`;
    const adminRes = await fetch(adminDocUrl, {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    if (adminRes.ok) {
      const adminDoc: any = await adminRes.json();
      const role = adminDoc?.fields?.role?.stringValue;
      return {
        authorized: true,
        adminEmail: callerEmail,
        adminUid: callerUid,
        idToken,
        isSuperAdmin: role === 'super_admin',
      };
    }

    return { authorized: false, error: 'Access Denied: Administrative permissions required for this action.' };
  } catch (err: any) {
    console.error('Error verifying admin caller:', err);
    return { authorized: false, error: 'Failed to verify caller credentials.' };
  }
}

export async function verifyUserCaller(
  request: Request,
  env?: Record<string, any>
): Promise<{
  authenticated: boolean;
  error?: string;
  userEmail?: string;
  userId?: string;
  idToken?: string;
  name?: string;
}> {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authenticated: false, error: 'Authentication required. Missing Bearer token.' };
  }
  const idToken = authHeader.split('Bearer ')[1].trim();
  if (!idToken) {
    return { authenticated: false, error: 'Empty authorization token provided.' };
  }

  try {
    const cfg = getFirebaseConfig(env);
    const lookupUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${cfg.apiKey}`;
    const lookupRes = await fetch(lookupUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const lookupData: any = await lookupRes.json();
    if (!lookupRes.ok || !lookupData.users || lookupData.users.length === 0) {
      return { authenticated: false, error: 'Invalid or expired user session. Please sign in again.' };
    }

    const caller = lookupData.users[0];
    const callerEmail = (caller.email || '').toLowerCase().trim();
    const callerUid = caller.localId;
    const displayName = caller.displayName || callerEmail.split('@')[0];

    return {
      authenticated: true,
      userEmail: callerEmail,
      userId: callerUid,
      idToken,
      name: displayName,
    };
  } catch (err: any) {
    console.error('Error verifying user caller:', err);
    return { authenticated: false, error: 'Failed to verify caller credentials.' };
  }
}
