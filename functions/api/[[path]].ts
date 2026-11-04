import {
  corsHeaders,
  deleteFirestoreDoc,
  deserializeFirestoreDoc,
  getFirebaseConfig,
  jsonResponse,
  PRIMARY_SUPER_ADMIN_EMAIL,
  readFirestoreDoc,
  verifyAdminCaller,
  verifyUserCaller,
  writeFirestoreDoc,
} from './_shared';

export async function onRequest(context: {
  request: Request;
  env: Record<string, any>;
}): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, '');
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  const cfg = getFirebaseConfig(env);

  try {
    // -----------------------------------------------------------------
    // 1. Employee Creation: POST /api/admin/employees/create
    // -----------------------------------------------------------------
    if (pathname === '/api/admin/employees/create' && method === 'POST') {
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

      if (selectedRole === 'super_admin' || selectedRole === 'hr_admin') {
        await writeFirestoreDoc(`admins/${authUid}`, {
          email: cleanEmail,
          role: selectedRole,
          grantedAt: now,
          grantedBy: admin.adminEmail,
        }, admin.idToken!, env);
      }

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
    }

    // -----------------------------------------------------------------
    // 2. Update Status: POST /api/admin/employees/update-status
    // -----------------------------------------------------------------
    if (pathname === '/api/admin/employees/update-status' && method === 'POST') {
      const admin = await verifyAdminCaller(request, env);
      if (!admin.authorized) {
        return jsonResponse({ success: false, error: admin.error || 'Unauthorized' }, 403);
      }

      const body: any = await request.json().catch(() => ({}));
      const { employeeId, email, status } = body;
      const cleanEmail = String(email || '').trim().toLowerCase();

      if (cleanEmail === PRIMARY_SUPER_ADMIN_EMAIL.toLowerCase() || cleanEmail === 'hammadkhanniaxii@gmail.com') {
        return jsonResponse({ success: false, error: 'Cannot modify primary Super Administrator status.' }, 403);
      }

      const newStatus = status === 'Disabled' ? 'Disabled' : 'Active';
      const now = new Date().toISOString();

      if (employeeId) {
        await writeFirestoreDoc(`employees/${employeeId}`, { status: newStatus, updatedAt: now }, admin.idToken!, env);
      }

      return jsonResponse({ success: true, message: `Account status updated to ${newStatus}.` });
    }

    // -----------------------------------------------------------------
    // 3. Reset Password: POST /api/admin/employees/reset-password
    // -----------------------------------------------------------------
    if (pathname === '/api/admin/employees/reset-password' && method === 'POST') {
      const admin = await verifyAdminCaller(request, env);
      if (!admin.authorized) {
        return jsonResponse({ success: false, error: admin.error || 'Unauthorized' }, 403);
      }

      const body: any = await request.json().catch(() => ({}));
      const { email, newPassword } = body;
      const cleanEmail = String(email || '').trim().toLowerCase();

      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
        return jsonResponse({ success: false, error: 'New password must be at least 8 characters.' }, 400);
      }

      const resetUrl = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${cfg.apiKey}`;
      await fetch(resetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: cleanEmail }),
      });

      return jsonResponse({ success: true, message: `Password reset instructions initiated for ${cleanEmail}.` });
    }

    // -----------------------------------------------------------------
    // 3b. First Sign-In Permanent Password Change: POST /api/auth/change-initial-password
    // -----------------------------------------------------------------
    if (pathname === '/api/auth/change-initial-password' && method === 'POST') {
      const user = await verifyUserCaller(request, env);
      if (!user.authenticated || !user.userId || !user.idToken) {
        return jsonResponse({
          success: false,
          error: user.error || 'Authentication required. Please sign in again.',
        }, 401);
      }

      const body: any = await request.json().catch(() => ({}));
      const { newPassword, confirmPassword, uid, userId, email } = body;

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

      if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 8 || newPassword.length < 8) {
        return jsonResponse({
          success: false,
          error: 'Permanent password must be at least 8 characters long.',
        }, 400);
      }
      if (newPassword.length > 128) {
        return jsonResponse({
          success: false,
          error: 'Password must not exceed 128 characters.',
        }, 400);
      }
      if (newPassword !== confirmPassword) {
        return jsonResponse({
          success: false,
          error: 'Passwords do not match.',
        }, 400);
      }

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
        return jsonResponse({
          success: false,
          error: fbErr || 'Failed to update permanent password in authentication provider.',
        }, 400);
      }

      const verifiedUid = updateData.localId || user.userId;
      const newToken = updateData.idToken;
      const now = new Date().toISOString();

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
        } catch (empErr) {
          console.warn('Employee directory mustChangePassword update notice:', empErr);
        }
      }

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
    }

    // -----------------------------------------------------------------
    // 4. Delete Employee: POST /api/admin/employees/delete
    // -----------------------------------------------------------------
    if (pathname === '/api/admin/employees/delete' && method === 'POST') {
      const admin = await verifyAdminCaller(request, env);
      if (!admin.authorized) {
        return jsonResponse({ success: false, error: admin.error || 'Unauthorized' }, 403);
      }

      const body: any = await request.json().catch(() => ({}));
      const { employeeId, email } = body;
      const cleanEmail = String(email || '').trim().toLowerCase();

      if (cleanEmail === PRIMARY_SUPER_ADMIN_EMAIL.toLowerCase() || cleanEmail === 'hammadkhanniaxii@gmail.com') {
        return jsonResponse({ success: false, error: 'The primary Super Administrator cannot be deleted.' }, 403);
      }

      if (employeeId) {
        await writeFirestoreDoc(`employees/${employeeId}`, {
          isDeleted: true,
          status: 'Deleted',
          deletedAt: new Date().toISOString(),
          deletedBy: admin.adminEmail,
        }, admin.idToken!, env);
      }

      return jsonResponse({ success: true, message: `Account ${cleanEmail} marked as deleted.` });
    }

    // -----------------------------------------------------------------
    // 5. Announcements Update / Delete
    // -----------------------------------------------------------------
    if (pathname === '/api/admin/announcements/update' && method === 'POST') {
      const admin = await verifyAdminCaller(request, env);
      if (!admin.authorized) {
        return jsonResponse({ success: false, error: admin.error || 'Unauthorized' }, 403);
      }
      const body: any = await request.json().catch(() => ({}));
      const { id, title, body: contentBody, message, audience, status, author } = body;
      if (!id || (!title && !message && !contentBody)) {
        return jsonResponse({ success: false, error: 'Announcement ID and content are required.' }, 400);
      }
      const now = new Date().toISOString();
      await writeFirestoreDoc(`announcements/${id}`, {
        title: title || 'Announcement',
        body: message || contentBody || '',
        message: message || contentBody || '',
        audience: audience || 'All Staff',
        status: status || 'Published',
        author: author || admin.adminEmail,
        updatedAt: now,
      }, admin.idToken!, env);
      return jsonResponse({ success: true, message: 'Announcement updated.' });
    }

    if (pathname === '/api/admin/announcements/delete' && method === 'POST') {
      const admin = await verifyAdminCaller(request, env);
      if (!admin.authorized) {
        return jsonResponse({ success: false, error: admin.error || 'Unauthorized' }, 403);
      }
      const body: any = await request.json().catch(() => ({}));
      const { id } = body;
      if (!id) {
        return jsonResponse({ success: false, error: 'Announcement ID is required.' }, 400);
      }
      await deleteFirestoreDoc(`announcements/${id}`, admin.idToken!, env);
      return jsonResponse({ success: true, message: 'Announcement deleted.' });
    }

    // -----------------------------------------------------------------
    // 6. Access Requests
    // -----------------------------------------------------------------
    if (pathname === '/api/access-requests' && method === 'POST') {
      const body: any = await request.json().catch(() => ({}));
      const { name, email, department } = body;
      if (!name || !email) {
        return jsonResponse({ success: false, error: 'Name and email are required.' }, 400);
      }
      const cleanEmail = String(email).trim().toLowerCase();
      const reqId = `req_${Date.now()}`;
      const now = new Date().toISOString();

      const anonymousKey = cfg.apiKey;
      const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents/access_requests/${reqId}?key=${anonymousKey}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            id: { stringValue: reqId },
            name: { stringValue: String(name).trim() },
            email: { stringValue: cleanEmail },
            department: { stringValue: department ? String(department).trim() : 'Advisory' },
            status: { stringValue: 'Pending' },
            createdAt: { stringValue: now },
            updatedAt: { stringValue: now },
          },
        }),
      });

      return jsonResponse({ success: true, message: 'Access request submitted.' });
    }

    if (pathname === '/api/admin/access-requests' && method === 'GET') {
      const admin = await verifyAdminCaller(request, env);
      if (!admin.authorized) {
        return jsonResponse({ success: false, error: admin.error || 'Unauthorized' }, 403);
      }
      const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents/access_requests`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${admin.idToken}` },
      });
      if (!res.ok) {
        return jsonResponse({ success: true, requests: [] });
      }
      const data: any = await res.json();
      const requests = (data.documents || []).map(deserializeFirestoreDoc).filter(Boolean);
      return jsonResponse({ success: true, requests });
    }

    if (pathname === '/api/admin/access-requests/update-status' && method === 'POST') {
      const admin = await verifyAdminCaller(request, env);
      if (!admin.authorized) {
        return jsonResponse({ success: false, error: admin.error || 'Unauthorized' }, 403);
      }
      const body: any = await request.json().catch(() => ({}));
      const { id, status } = body;
      if (id && status) {
        await writeFirestoreDoc(`access_requests/${id}`, { status, updatedAt: new Date().toISOString() }, admin.idToken!, env);
      }
      return jsonResponse({ success: true, message: 'Request status updated.' });
    }

    if (pathname === '/api/admin/access-requests/delete' && method === 'POST') {
      const admin = await verifyAdminCaller(request, env);
      if (!admin.authorized) {
        return jsonResponse({ success: false, error: admin.error || 'Unauthorized' }, 403);
      }
      const body: any = await request.json().catch(() => ({}));
      const { id } = body;
      if (id) {
        await deleteFirestoreDoc(`access_requests/${id}`, admin.idToken!, env);
      }
      return jsonResponse({ success: true, message: 'Request deleted.' });
    }

    // -----------------------------------------------------------------
    // 7. Leave Status Update: POST /api/admin/leaves/update-status
    // -----------------------------------------------------------------
    if (pathname === '/api/admin/leaves/update-status' && method === 'POST') {
      const admin = await verifyAdminCaller(request, env);
      if (!admin.authorized) {
        return jsonResponse({ success: false, error: admin.error || 'Unauthorized' }, 403);
      }
      const body: any = await request.json().catch(() => ({}));
      const { leaveId, status } = body;
      if (!leaveId || !status) {
        return jsonResponse({ success: false, error: 'Leave ID and status are required.' }, 400);
      }
      await writeFirestoreDoc(`leaves/${leaveId}`, {
        status,
        decidedBy: admin.adminEmail,
        decidedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, admin.idToken!, env);
      return jsonResponse({ success: true, message: `Leave status updated to ${status}.` });
    }

    // -----------------------------------------------------------------
    // 8. Bootstrap Status & Activation
    // -----------------------------------------------------------------
    if (pathname === '/api/admin/bootstrap-status' && method === 'GET') {
      const doc = await readFirestoreDoc('system_metadata/super_admin_bootstrap', '', env);
      const isActivated = doc?.isActivated === true;
      return jsonResponse({
        isActivated,
        canActivate: !isActivated,
        targetEmail: PRIMARY_SUPER_ADMIN_EMAIL,
        message: isActivated
          ? 'Primary Super Administrator account has already been permanently activated.'
          : 'Primary Super Administrator account is pending first-time activation.',
      });
    }

    // -----------------------------------------------------------------
    // 9. Attendance API fallback
    // -----------------------------------------------------------------
    if (pathname.startsWith('/api/attendance/')) {
      const user = await verifyUserCaller(request, env);
      if (!user.authenticated) {
        return jsonResponse({ success: false, error: user.error || 'Unauthorized' }, 403);
      }
      const subPath = pathname.replace('/api/attendance/', '');
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();

      if (subPath === 'active' && method === 'GET') {
        const activeDoc = await readFirestoreDoc(`attendance/active_${user.userId}`, user.idToken!, env);
        if (activeDoc && activeDoc.isActive) {
          return jsonResponse({ success: true, session: activeDoc });
        }
        return jsonResponse({ success: true, session: null });
      }

      if (subPath === 'clock-in' && method === 'POST') {
        const activeDoc = {
          userId: user.userId,
          employeeEmail: user.userEmail,
          employeeName: user.name,
          clockInTimestamp: nowMs,
          clockInIso: nowIso,
          state: 'Working',
          isActive: true,
          breaks: [],
          updatedAt: nowIso,
        };
        await writeFirestoreDoc(`attendance/active_${user.userId}`, activeDoc, user.idToken!, env);
        return jsonResponse({ success: true, session: activeDoc });
      }

      if (subPath === 'start-break' && method === 'POST') {
        const activeDoc = await readFirestoreDoc(`attendance/active_${user.userId}`, user.idToken!, env);
        if (!activeDoc || !activeDoc.isActive) {
          return jsonResponse({ success: false, error: 'No active session to pause.' }, 400);
        }
        const breaks = Array.isArray(activeDoc.breaks) ? activeDoc.breaks : [];
        breaks.push({ startTime: nowMs, startIso: nowIso, endTime: null });
        activeDoc.state = 'On break';
        activeDoc.breaks = breaks;
        activeDoc.updatedAt = nowIso;
        await writeFirestoreDoc(`attendance/active_${user.userId}`, activeDoc, user.idToken!, env);
        return jsonResponse({ success: true, session: activeDoc });
      }

      if (subPath === 'end-break' && method === 'POST') {
        const activeDoc = await readFirestoreDoc(`attendance/active_${user.userId}`, user.idToken!, env);
        if (!activeDoc || !activeDoc.isActive) {
          return jsonResponse({ success: false, error: 'No active session.' }, 400);
        }
        const breaks = Array.isArray(activeDoc.breaks) ? activeDoc.breaks : [];
        if (breaks.length > 0 && breaks[breaks.length - 1].endTime === null) {
          breaks[breaks.length - 1].endTime = nowMs;
          breaks[breaks.length - 1].endIso = nowIso;
        }
        activeDoc.state = 'Working';
        activeDoc.breaks = breaks;
        activeDoc.updatedAt = nowIso;
        await writeFirestoreDoc(`attendance/active_${user.userId}`, activeDoc, user.idToken!, env);
        return jsonResponse({ success: true, session: activeDoc });
      }

      if (subPath === 'clock-out' && method === 'POST') {
        const activeDoc = await readFirestoreDoc(`attendance/active_${user.userId}`, user.idToken!, env);
        if (!activeDoc || !activeDoc.isActive) {
          return jsonResponse({ success: false, error: 'No active session to end.' }, 400);
        }
        const breaks = Array.isArray(activeDoc.breaks) ? activeDoc.breaks : [];
        if (breaks.length > 0 && breaks[breaks.length - 1].endTime === null) {
          breaks[breaks.length - 1].endTime = nowMs;
          breaks[breaks.length - 1].endIso = nowIso;
        }
        const clockInMs = activeDoc.clockInTimestamp || nowMs;
        const totalDurationSec = Math.max(0, Math.floor((nowMs - clockInMs) / 1000));
        let totalBreakSec = 0;
        for (const b of breaks) {
          if (b.startTime && b.endTime) {
            totalBreakSec += Math.max(0, Math.floor((b.endTime - b.startTime) / 1000));
          }
        }
        const netWorkSec = Math.max(0, totalDurationSec - totalBreakSec);
        const recordId = `rec_${user.userId}_${nowMs}`;
        const finalDoc = {
          ...activeDoc,
          id: recordId,
          clockOutTimestamp: nowMs,
          clockOutIso: nowIso,
          state: 'Completed',
          isActive: false,
          breaks,
          shiftElapsedSeconds: totalDurationSec,
          totalBreakSeconds: totalBreakSec,
          netWorkingSeconds: netWorkSec,
          updatedAt: nowIso,
        };
        await writeFirestoreDoc(`attendance/${recordId}`, finalDoc, user.idToken!, env);
        await deleteFirestoreDoc(`attendance/active_${user.userId}`, user.idToken!, env);
        return jsonResponse({ success: true, session: finalDoc });
      }
    }

    // Default 404 for unknown /api/* endpoint
    return jsonResponse({ success: false, error: `API route ${pathname} not found on server.` }, 404);
  } catch (err: any) {
    console.error(`Error handling ${method} ${pathname}:`, err);
    return jsonResponse({ success: false, error: err.message || 'Internal server error.' }, 500);
  }
}
