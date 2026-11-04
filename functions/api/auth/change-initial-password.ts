// Cloudflare Pages Function: /api/auth/change-initial-password
// Handles mandatory first-sign-in permanent password establishment

const defaultFirebaseConfig = {
  projectId: 'clean-striker-r9v0l',
  appId: '1:603858171718:web:c47ccc94c8ace919669747',
  apiKey: 'AIzaSyDwNOJbHHNsfJPHEs-pBVqAXhgnMXzfm74',
  authDomain: 'clean-striker-r9v0l.firebaseapp.com',
  firestoreDatabaseId: 'ai-studio-gaworkspacegrowt-800706db-ad9e-4c45-9fd5-b7cfb2abdddf',
  storageBucket: 'clean-striker-r9v0l.firebasestorage.app',
  messagingSenderId: '603858171718',
};

function getFirebaseConfig(env?: Record<string, any>) {
  return {
    projectId: env?.FIREBASE_PROJECT_ID || defaultFirebaseConfig.projectId,
    apiKey: env?.FIREBASE_API_KEY || defaultFirebaseConfig.apiKey,
    firestoreDatabaseId: env?.FIREBASE_FIRESTORE_DATABASE_ID || defaultFirebaseConfig.firestoreDatabaseId,
  };
}

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders,
    },
  });
}

function serializeToFirestoreValue(val: any): any {
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

function deserializeFirestoreValue(val: any): any {
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

function deserializeFirestoreDoc(docItem: any): any {
  if (!docItem || !docItem.fields) return null;
  const nameParts = (docItem.name || '').split('/');
  const docId = nameParts[nameParts.length - 1];
  const obj: Record<string, any> = { id: docId };
  for (const [key, val] of Object.entries(docItem.fields)) {
    obj[key] = deserializeFirestoreValue(val);
  }
  return obj;
}

async function readFirestoreDoc(
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

async function writeFirestoreDoc(
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

async function verifyUserCaller(
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
    return { authenticated: false, error: 'Authentication required. Missing Bearer authorization token.' };
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
      return { authenticated: false, error: 'Invalid or expired authentication session. Please sign in again.' };
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
    return { authenticated: false, error: 'Failed to verify user credentials.' };
  }
}

function validatePasswordPolicy(password: string): string | null {
  if (!password || typeof password !== 'string') return 'Password is required.';
  if (password.trim().length < 8 || password.length < 8) {
    return 'Permanent password must be at least 8 characters long.';
  }
  if (password.length > 128) {
    return 'Password must not exceed 128 characters.';
  }
  return null;
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function onRequestPost(context: {
  request: Request;
  env: Record<string, any>;
}): Promise<Response> {
  const { request, env } = context;

  try {
    // 1. Verify caller identity server-side from Bearer token
    const user = await verifyUserCaller(request, env);
    if (!user.authenticated || !user.userId || !user.idToken) {
      return jsonResponse({
        success: false,
        error: user.error || 'Authentication required. Please sign in again.',
      }, 401);
    }

    const body: any = await request.json().catch(() => ({}));
    const { newPassword, confirmPassword, uid, userId, email } = body;

    // 2. Reject any attempt to specify a different user's ID or email
    if (
      (uid && String(uid).trim() !== user.userId) ||
      (userId && String(userId).trim() !== user.userId) ||
      (email && String(email).toLowerCase().trim() !== user.userEmail)
    ) {
      return jsonResponse({
        success: false,
        error: 'Access Denied: You can only change the password for your own authenticated account.',
      }, 403);
    }

    // 3. Validate new password against policy
    const passErr = validatePasswordPolicy(newPassword);
    if (passErr) {
      return jsonResponse({ success: false, error: passErr }, 400);
    }
    if (newPassword !== confirmPassword) {
      return jsonResponse({ success: false, error: 'Passwords do not match.' }, 400);
    }

    // 4. Verify account state in Firestore and ensure mustChangePassword is true
    const userDoc = await readFirestoreDoc(`users/${user.userId}`, user.idToken, env);
    if (!userDoc) {
      return jsonResponse({
        success: false,
        error: 'Access Denied: User account record not found in directory.',
      }, 403);
    }

    if (userDoc.status && userDoc.status !== 'Active') {
      return jsonResponse({
        success: false,
        error: 'Access Denied: This account is not active.',
      }, 403);
    }

    if (userDoc.mustChangePassword !== true) {
      return jsonResponse({
        success: false,
        error: 'Initial password change has already been completed or is not required for this account.',
      }, 400);
    }

    // 5. Update password in Firebase Authentication via Identity Toolkit
    const cfg = getFirebaseConfig(env);
    const updateUrl = `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${cfg.apiKey}`;
    const updateRes = await fetch(updateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken: user.idToken,
        password: newPassword,
        returnSecureToken: true,
      }),
    });

    const updateData: any = await updateRes.json();
    if (!updateRes.ok || !updateData.idToken) {
      const fbErr = updateData?.error?.message || '';
      if (
        fbErr.includes('CREDENTIAL_TOO_OLD_LOGIN_AGAIN') ||
        fbErr.includes('TOKEN_EXPIRED') ||
        fbErr.includes('INVALID_ID_TOKEN')
      ) {
        return jsonResponse({
          success: false,
          error: 'Your authentication session has expired. Please sign out and sign in again with your temporary password.',
        }, 401);
      }
      if (fbErr.includes('WEAK_PASSWORD')) {
        return jsonResponse({
          success: false,
          error: 'Password is too weak. Please choose a stronger password of at least 8 characters.',
        }, 400);
      }
      return jsonResponse({
        success: false,
        error: fbErr || 'Failed to update permanent password in authentication provider.',
      }, 400);
    }

    const verifiedUid = updateData.localId || user.userId;
    const newToken = updateData.idToken;
    const now = new Date().toISOString();

    // 6. Clear mustChangePassword flag ONLY after Firebase Auth password update succeeds
    await writeFirestoreDoc(`users/${verifiedUid}`, {
      mustChangePassword: false,
      updatedAt: now,
    }, newToken, env);

    if (userDoc.employeeId) {
      try {
        const existingEmp = await readFirestoreDoc(`employees/${userDoc.employeeId}`, newToken, env);
        if (existingEmp) {
          await writeFirestoreDoc(`employees/${userDoc.employeeId}`, {
            email: existingEmp.email || userDoc.email || user.userEmail,
            mustChangePassword: false,
            updatedAt: now,
          }, newToken, env);
        }
      } catch (empUpdateErr) {
        console.warn('Employee directory mustChangePassword update notice:', empUpdateErr);
      }
    }

    // 7. Record immutable audit log (never log passwords)
    const auditRandom = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 8);
    const auditLogId = `audit_${Date.now()}_${auditRandom}`;

    try {
      await writeFirestoreDoc(`audit_logs/${auditLogId}`, {
        action: 'INITIAL_PASSWORD_CHANGED',
        actorEmail: user.userEmail || userDoc.email,
        actorUid: verifiedUid,
        targetEmail: user.userEmail || userDoc.email,
        timestamp: now,
        details: `Employee ${userDoc.name || user.userEmail} completed mandatory first-sign-in permanent password setup.`,
      }, newToken, env);
    } catch (auditErr) {
      console.warn('Audit log write notice:', auditErr);
    }

    return jsonResponse({
      success: true,
      message: 'Permanent password established successfully.',
      idToken: newToken,
      uid: verifiedUid,
    }, 200);
  } catch (err: any) {
    console.error('Error in /api/auth/change-initial-password:', err);
    return jsonResponse({
      success: false,
      error: err.message || 'Internal server error changing password.',
    }, 500);
  }
}

export async function onRequestGet(): Promise<Response> {
  return jsonResponse({
    success: false,
    error: 'Method GET Not Allowed on /api/auth/change-initial-password. Please use POST with JSON payload.',
  }, 405);
}

export async function onRequest(context: {
  request: Request;
  env: Record<string, any>;
}): Promise<Response> {
  if (context.request.method === 'OPTIONS') {
    return onRequestOptions();
  }
  if (context.request.method === 'POST') {
    return onRequestPost(context);
  }
  if (context.request.method === 'GET') {
    return onRequestGet();
  }
  return jsonResponse({ success: false, error: `Method ${context.request.method} Not Allowed` }, 405);
}
