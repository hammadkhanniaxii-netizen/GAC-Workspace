// Cloudflare Pages Function: /api/admin/employees/create
// Handles direct employee and admin account provisioning on Cloudflare Pages

const defaultFirebaseConfig = {
  projectId: 'clean-striker-r9v0l',
  appId: '1:603858171718:web:c47ccc94c8ace919669747',
  apiKey: 'AIzaSyDwNOJbHHNsfJPHEs-pBVqAXhgnMXzfm74',
  authDomain: 'clean-striker-r9v0l.firebaseapp.com',
  firestoreDatabaseId: 'ai-studio-gaworkspacegrowt-800706db-ad9e-4c45-9fd5-b7cfb2abdddf',
  storageBucket: 'clean-striker-r9v0l.firebasestorage.app',
  messagingSenderId: '603858171718',
};

const PRIMARY_SUPER_ADMIN_EMAIL = 'hammad@growthalliance.net';

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

async function verifyAdminCaller(
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
    const admin = await verifyAdminCaller(request, env);
    if (!admin.authorized) {
      return jsonResponse({ success: false, error: admin.error || 'Unauthorized' }, 403);
    }

    const body: any = await request.json().catch(() => ({}));
    const { name, email, employeeId, department, title, role, password, confirmPassword, status } = body;

    if (!name || typeof name !== 'string' || name.trim().length < 3) {
      return jsonResponse({ success: false, error: 'Full name is required (minimum 3 characters).' }, 400);
    }

    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return jsonResponse({ success: false, error: 'A valid corporate email address is required.' }, 400);
    }

    const selectedRole = role || 'employee';
    if (selectedRole === 'super_admin' && !admin.isSuperAdmin) {
      return jsonResponse({
        success: false,
        error: 'Access Denied: Only Super Administrators can assign the Super Administrator role.',
      }, 403);
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return jsonResponse({ success: false, error: 'Initial password must be at least 8 characters long.' }, 400);
    }

    if (password !== confirmPassword) {
      return jsonResponse({ success: false, error: 'Initial password and password confirmation do not match.' }, 400);
    }

    const finalEmployeeId = employeeId && String(employeeId).trim()
      ? String(employeeId).trim()
      : `GA-${Math.floor(100 + Math.random() * 900)}`;

    const initialStatus = status === 'Disabled' ? 'Disabled' : 'Active';
    const now = new Date().toISOString();
    const cfg = getFirebaseConfig(env);

    // Check for duplicate employee ID
    const empDocUrl = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents/employees/${finalEmployeeId}`;
    const empCheckRes = await fetch(empDocUrl, {
      headers: { Authorization: `Bearer ${admin.idToken}` },
    });
    if (empCheckRes.ok) {
      const existingDoc: any = await empCheckRes.json();
      const existingData = deserializeFirestoreDoc(existingDoc);
      if (existingData && !existingData.isDeleted && existingData.email !== cleanEmail) {
        return jsonResponse({
          success: false,
          error: `Employee ID "${finalEmployeeId}" is already assigned to ${existingData.name || existingData.email}. Please choose a unique Employee ID.`,
        }, 409);
      }
    }

    // 1. Create account in Firebase Authentication
    const signUpUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`;
    const signUpRes = await fetch(signUpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: cleanEmail,
        password: password,
        displayName: name.trim(),
        returnSecureToken: true,
      }),
    });

    let authUid = '';
    const signUpData: any = await signUpRes.json();
    if (!signUpRes.ok || !signUpData.localId) {
      if (signUpData?.error?.message === 'EMAIL_EXISTS') {
        const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.apiKey}`;
        const signInRes = await fetch(signInUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            password: password,
            returnSecureToken: true,
          }),
        });
        const signInData: any = await signInRes.json();
        if (signInRes.ok && signInData.localId) {
          authUid = signInData.localId;
        } else {
          return jsonResponse({
            success: false,
            error: 'An account with this email address already exists. If you are re-provisioning this member, please enter their existing password, or use the Reset Password action in the portal.',
          }, 409);
        }
      } else {
        return jsonResponse({
          success: false,
          error: signUpData?.error?.message || 'Failed to create user in Firebase Authentication.',
        }, 400);
      }
    } else {
      authUid = signUpData.localId;
    }

    // 2. Persist Employee Directory document
    const employeeDoc = {
      id: finalEmployeeId,
      employeeId: finalEmployeeId,
      name: name.trim(),
      email: cleanEmail,
      department: department ? String(department).trim() : 'Enterprise Advisory',
      title: title ? String(title).trim() : 'Consultant',
      role: selectedRole,
      status: initialStatus,
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now,
    };

    await writeFirestoreDoc(`employees/${finalEmployeeId}`, employeeDoc, admin.idToken!, env);

    // 3. Persist User Account document
    await writeFirestoreDoc(`users/${authUid}`, {
      id: authUid,
      employeeId: finalEmployeeId,
      name: name.trim(),
      email: cleanEmail,
      department: department ? String(department).trim() : 'Enterprise Advisory',
      title: title ? String(title).trim() : 'Consultant',
      role: selectedRole,
      status: initialStatus,
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now,
    }, admin.idToken!, env);

    // 4. Persist Admin record if administrative role
    if (selectedRole === 'super_admin' || selectedRole === 'hr_admin') {
      await writeFirestoreDoc(`admins/${authUid}`, {
        email: cleanEmail,
        role: selectedRole,
        grantedAt: now,
        grantedBy: admin.adminEmail,
      }, admin.idToken!, env);
    }

    // 5. Audit Log Record
    const auditRandom = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 8);
    const auditLogId = `audit_${Date.now()}_${auditRandom}`;

    await writeFirestoreDoc(`audit_logs/${auditLogId}`, {
      action: 'EMPLOYEE_ACCOUNT_CREATED',
      actorEmail: admin.adminEmail,
      actorUid: admin.adminUid,
      targetEmail: cleanEmail,
      timestamp: now,
      details: `Directly created ${selectedRole} account for ${name.trim()} (${cleanEmail}) with initial status ${initialStatus} and forced password change on first login.`,
    }, admin.idToken!, env);

    return jsonResponse({
      success: true,
      message: `Account created successfully with status ${initialStatus}.`,
      employee: employeeDoc,
      user: {
        uid: authUid,
        email: cleanEmail,
        status: initialStatus,
        mustChangePassword: true,
      },
    }, 200);
  } catch (err: any) {
    console.error('Account creation error in Cloudflare Pages Function:', err);
    return jsonResponse({
      success: false,
      error: err.message || 'Internal error creating employee account.',
    }, 500);
  }
}

export async function onRequestGet(): Promise<Response> {
  return jsonResponse({
    success: false,
    error: 'Method GET Not Allowed on /api/admin/employees/create. Please use POST with JSON payload.',
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
