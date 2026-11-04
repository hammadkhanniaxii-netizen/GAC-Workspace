import {
  corsHeaders,
  getFirebaseConfig,
  jsonResponse,
  verifyAdminCaller,
  writeFirestoreDoc,
} from '../../_shared';

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
  return jsonResponse({ success: false, error: `Method ${context.request.method} Not Allowed` }, 405);
}
