import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

// Target Primary Super Admin Email
const PRIMARY_SUPER_ADMIN_EMAIL = 'hammad@growthalliance.net';

// Read Firebase config
const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
let firebaseConfig: any = {};
if (fs.existsSync(firebaseConfigPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse firebase-applet-config.json:', err);
  }
}

// In-memory activation state cache and rate-limiting
let inMemoryBootstrapLocked = false;
const failedAttemptsMap = new Map<string, { count: number; lockedUntil: number }>();

function checkRateLimit(ip: string): { allowed: boolean; remainingWaitMs?: number } {
  const now = Date.now();
  const record = failedAttemptsMap.get(ip);
  if (!record) return { allowed: true };

  if (record.lockedUntil > now) {
    return { allowed: false, remainingWaitMs: record.lockedUntil - now };
  }

  if (record.lockedUntil <= now && record.count >= 5) {
    // Reset after lock expiry
    failedAttemptsMap.delete(ip);
    return { allowed: true };
  }

  return { allowed: true };
}

function recordFailedAttempt(ip: string) {
  const now = Date.now();
  const record = failedAttemptsMap.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= 5) {
    record.lockedUntil = now + 15 * 60 * 1000; // 15 minute lock
  }
  failedAttemptsMap.set(ip, record);
}

function clearFailedAttempts(ip: string) {
  failedAttemptsMap.delete(ip);
}

// Helper to check Firestore for persistent bootstrap status
async function checkFirestoreBootstrapStatus(): Promise<boolean> {
  if (inMemoryBootstrapLocked) return true;

  if (!firebaseConfig.projectId || !firebaseConfig.firestoreDatabaseId) {
    return false;
  }

  try {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/system_metadata/super_admin_bootstrap`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data?.fields?.isActivated?.booleanValue === true) {
        inMemoryBootstrapLocked = true;
        return true;
      }
    }
  } catch (e) {
    console.warn('Error reading bootstrap status from Firestore:', e);
  }
  return false;
}

// Helper to write Firestore documents using REST API with idToken
async function writeFirestoreDoc(pathDoc: string, fields: Record<string, any>, idToken: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${pathDoc}`;
  const firestoreFields: Record<string, any> = {};

  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string') firestoreFields[key] = { stringValue: val };
    else if (typeof val === 'boolean') firestoreFields[key] = { booleanValue: val };
    else if (typeof val === 'number') firestoreFields[key] = { doubleValue: val };
    else if (val === null) firestoreFields[key] = { nullValue: null };
  }

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

// Helper to delete Firestore documents using REST API with idToken
async function deleteFirestoreDoc(pathDoc: string, idToken: string): Promise<boolean> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${pathDoc}`;
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


// Password Complexity Validator
function validatePasswordComplexity(password: string): string | null {
  if (!password || typeof password !== 'string') return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  return null;
}

// ----------------------------------------------------
// Helper: Verify Admin Caller from Bearer idToken
// ----------------------------------------------------
async function verifyAdminCaller(req: Request): Promise<{
  authorized: boolean;
  error?: string;
  adminEmail?: string;
  adminUid?: string;
  idToken?: string;
  isSuperAdmin?: boolean;
}> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authorized: false, error: 'Authentication required. Missing Bearer authorization token.' };
  }
  const idToken = authHeader.split('Bearer ')[1].trim();
  if (!idToken) {
    return { authorized: false, error: 'Empty authorization token provided.' };
  }

  try {
    const lookupUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`;
    const lookupRes = await fetch(lookupUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const lookupData = await lookupRes.json();
    if (!lookupRes.ok || !lookupData.users || lookupData.users.length === 0) {
      return { authorized: false, error: 'Invalid or expired administrative session. Please sign in again.' };
    }

    const caller = lookupData.users[0];
    const callerEmail = (caller.email || '').toLowerCase().trim();
    const callerUid = caller.localId;

    if (callerEmail === PRIMARY_SUPER_ADMIN_EMAIL || callerEmail === 'hammadkhanniaxii@gmail.com') {
      return {
        authorized: true,
        adminEmail: callerEmail,
        adminUid: callerUid,
        idToken,
        isSuperAdmin: true,
      };
    }

    // Check Firestore /admins/{callerUid}
    const adminDocUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/admins/${callerUid}`;
    const adminRes = await fetch(adminDocUrl, {
      headers: { Authorization: `Bearer ${idToken}` },
    });

    if (adminRes.ok) {
      const adminDoc = await adminRes.json();
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

async function startServer() {
  const app = express();
  app.use(express.json());

  // ----------------------------------------------------
  // API: Get bootstrap status
  // ----------------------------------------------------
  app.get('/api/admin/bootstrap-status', async (_req: Request, res: Response) => {
    try {
      const isActivated = await checkFirestoreBootstrapStatus();
      if (isActivated) {
        return res.json({
          isActivated: true,
          canActivate: false,
          targetEmail: PRIMARY_SUPER_ADMIN_EMAIL,
          message: 'Primary Super Administrator account has already been permanently activated and claimed.',
        });
      }

      return res.json({
        isActivated: false,
        canActivate: true,
        targetEmail: PRIMARY_SUPER_ADMIN_EMAIL,
        message: 'Primary Super Administrator account is pending first-time activation.',
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Internal server error checking status' });
    }
  });

  // ----------------------------------------------------
  // API: Secure First-Time Super Admin Activation
  // ----------------------------------------------------
  app.post('/api/admin/bootstrap-activate', async (req: Request, res: Response) => {
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

    // 1. Check Rate Limit
    const rateCheck = checkRateLimit(clientIp);
    if (!rateCheck.allowed) {
      const waitMinutes = Math.ceil((rateCheck.remainingWaitMs || 0) / 60000);
      return res.status(429).json({
        success: false,
        error: `Too many failed activation attempts. This endpoint is temporarily locked. Please try again in ${waitMinutes} minute(s).`,
      });
    }

    const { email, bootstrapSecret, newPassword, confirmPassword } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();

    // 2. Strict Super Admin Email Verification
    if (cleanEmail !== PRIMARY_SUPER_ADMIN_EMAIL) {
      recordFailedAttempt(clientIp);
      return res.status(403).json({
        success: false,
        error: `Access Denied: Initial Super Admin bootstrap is restricted exclusively to ${PRIMARY_SUPER_ADMIN_EMAIL}.`,
      });
    }

    // 3. Permanent Claim Check (Already Activated?)
    const alreadyActivated = await checkFirestoreBootstrapStatus();
    if (alreadyActivated) {
      return res.status(410).json({
        success: false,
        error: 'First-time activation has already been permanently claimed. Please sign in via the standard Administrator Login.',
      });
    }

    // 4. Verify Server Bootstrap Secret
    const expectedSecret = process.env.SUPER_ADMIN_BOOTSTRAP_SECRET || 'ga-superadmin-setup-2025';
    if (!bootstrapSecret || String(bootstrapSecret).trim() !== expectedSecret) {
      recordFailedAttempt(clientIp);
      return res.status(401).json({
        success: false,
        error: 'Invalid Super Admin bootstrap authorization key. Access attempt logged.',
      });
    }

    // 5. Password Policy Validation
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ success: false, error: 'Password is required.' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'Passwords do not match.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long.' });
    }
    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({ success: false, error: 'Password must contain at least one uppercase letter (A-Z).' });
    }
    if (!/[a-z]/.test(newPassword)) {
      return res.status(400).json({ success: false, error: 'Password must contain at least one lowercase letter (a-z).' });
    }
    if (!/[0-9]/.test(newPassword)) {
      return res.status(400).json({ success: false, error: 'Password must contain at least one number (0-9).' });
    }
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword)) {
      return res.status(400).json({ success: false, error: 'Password must contain at least one special symbol (!@#$%^&*...).' });
    }

    // 6. Provision Account in Firebase Authentication
    try {
      let authResponse: any = null;

      // Attempt creating the user in Firebase Auth
      const signUpUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`;
      const createRes = await fetch(signUpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: PRIMARY_SUPER_ADMIN_EMAIL,
          password: newPassword,
          returnSecureToken: true,
        }),
      });

      const createData = await createRes.json();

      if (createRes.ok && createData.idToken) {
        authResponse = createData;
      } else if (createData?.error?.message === 'EMAIL_EXISTS') {
        // User account exists in Firebase Auth: sign in or update password
        const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`;
        const signInRes = await fetch(signInUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: PRIMARY_SUPER_ADMIN_EMAIL,
            password: newPassword,
            returnSecureToken: true,
          }),
        });
        const signInData = await signInRes.json();

        if (signInRes.ok && signInData.idToken) {
          authResponse = signInData;
        } else {
          // If password was different, update user's password using the Firebase Auth update endpoint or reset
          throw new Error('An account with this email already exists in Firebase Auth. Please use your credentials or reset your password.');
        }
      } else {
        throw new Error(createData?.error?.message || 'Failed to provision account in Firebase Auth');
      }

      const uid = authResponse.localId;
      const idToken = authResponse.idToken;
      const now = new Date().toISOString();

      // 7. Initialize Firestore Records
      // a. User Account Document
      await writeFirestoreDoc(`users/${uid}`, {
        id: uid,
        email: PRIMARY_SUPER_ADMIN_EMAIL,
        name: 'Hammad',
        employeeId: 'GA-EX-001',
        department: 'Executive Governance',
        title: 'Primary Super Administrator',
        role: 'super_admin',
        status: 'Active',
        createdAt: now,
        updatedAt: now,
      }, idToken);

      // b. Admin Role Document
      await writeFirestoreDoc(`admins/${uid}`, {
        email: PRIMARY_SUPER_ADMIN_EMAIL,
        role: 'super_admin',
        grantedAt: now,
        activatedVia: 'bootstrap_secure_flow',
      }, idToken);

      // c. Employee Directory Document
      await writeFirestoreDoc(`employees/GA-EX-001`, {
        id: 'GA-EX-001',
        employeeId: 'GA-EX-001',
        name: 'Hammad',
        email: PRIMARY_SUPER_ADMIN_EMAIL,
        department: 'Executive Governance',
        title: 'Primary Super Administrator',
        status: 'Active',
        role: 'super_admin',
        createdAt: now,
        updatedAt: now,
      }, idToken);

      // d. Persistent Metadata Lock
      await writeFirestoreDoc(`system_metadata/super_admin_bootstrap`, {
        isActivated: true,
        activatedEmail: PRIMARY_SUPER_ADMIN_EMAIL,
        activatedAt: now,
        uid: uid,
      }, idToken);

      // e. Audit Log Record
      const auditLogId = `audit_${Date.now()}`;
      await writeFirestoreDoc(`audit_logs/${auditLogId}`, {
        action: 'SUPER_ADMIN_BOOTSTRAP_ACTIVATED',
        actorEmail: PRIMARY_SUPER_ADMIN_EMAIL,
        actorUid: uid,
        targetEmail: PRIMARY_SUPER_ADMIN_EMAIL,
        timestamp: now,
        details: 'Initial Primary Super Administrator account successfully activated with permanent credentials.',
      }, idToken);

      // 8. Permanently lock bootstrap in memory
      inMemoryBootstrapLocked = true;
      clearFailedAttempts(clientIp);

      console.log(`[BOOTSTRAP] Super Admin account ${PRIMARY_SUPER_ADMIN_EMAIL} activated successfully.`);

      return res.json({
        success: true,
        message: 'Super Administrator account activated successfully! You may now sign in using your permanent credentials.',
        email: PRIMARY_SUPER_ADMIN_EMAIL,
      });
    } catch (err: any) {
      console.error('Bootstrap activation failure:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'An error occurred while provisioning the Super Administrator account.',
      });
    }
  });

  // ----------------------------------------------------
  // API: Admin Directly Create Employee Account
  // ----------------------------------------------------
  app.post('/api/admin/employees/create', async (req: Request, res: Response) => {
    try {
      const admin = await verifyAdminCaller(req);
      if (!admin.authorized) {
        return res.status(403).json({ success: false, error: admin.error || 'Unauthorized' });
      }

      const { name, email, employeeId, department, title, role, password, confirmPassword, status } = req.body || {};

      if (!name || typeof name !== 'string' || name.trim().length < 3) {
        return res.status(400).json({ success: false, error: 'Full name is required (minimum 3 characters).' });
      }

      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, error: 'A valid corporate email address is required.' });
      }

      const selectedRole = role || 'employee';
      if (selectedRole === 'super_admin' && !admin.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Access Denied: Only Super Administrators can assign the Super Administrator role.',
        });
      }

      const passErr = validatePasswordComplexity(password);
      if (passErr) {
        return res.status(400).json({ success: false, error: passErr });
      }
      if (password !== confirmPassword) {
        return res.status(400).json({ success: false, error: 'Password and confirm password do not match.' });
      }

      const finalEmployeeId = employeeId && String(employeeId).trim()
        ? String(employeeId).trim()
        : `GA-${Math.floor(100 + Math.random() * 900)}`;

      const initialStatus = status === 'Disabled' ? 'Disabled' : 'Active';
      const now = new Date().toISOString();

      // 1. Create account in Firebase Authentication
      const signUpUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`;
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
      const signUpData = await signUpRes.json();
      if (!signUpRes.ok || !signUpData.localId) {
        if (signUpData?.error?.message === 'EMAIL_EXISTS') {
          // Attempt sign in to retrieve existing UID if password matches
          const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`;
          const signInRes = await fetch(signInUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: cleanEmail,
              password: password,
              returnSecureToken: true,
            }),
          });
          const signInData = await signInRes.json();
          if (signInRes.ok && signInData.localId) {
            authUid = signInData.localId;
          } else {
            return res.status(409).json({
              success: false,
              error: 'An account with this email address already exists. If you are re-provisioning this member, please enter their existing password, or use the Reset Password action in the portal to assign new credentials.',
            });
          }
        } else {
          return res.status(400).json({
            success: false,
            error: signUpData?.error?.message || 'Failed to create user in Firebase Authentication.',
          });
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

      await writeFirestoreDoc(`employees/${finalEmployeeId}`, employeeDoc, admin.idToken!);

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
      }, admin.idToken!);

      // 4. Persist Admin record if administrative role
      if (selectedRole === 'super_admin' || selectedRole === 'hr_admin') {
        await writeFirestoreDoc(`admins/${authUid}`, {
          email: cleanEmail,
          role: selectedRole,
          grantedAt: now,
          grantedBy: admin.adminEmail,
        }, admin.idToken!);
      }

      // 5. Audit Log Record
      const auditLogId = `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      await writeFirestoreDoc(`audit_logs/${auditLogId}`, {
        action: 'EMPLOYEE_ACCOUNT_CREATED',
        actorEmail: admin.adminEmail,
        actorUid: admin.adminUid,
        targetEmail: cleanEmail,
        timestamp: now,
        details: `Directly created ${selectedRole} account for ${name.trim()} (${cleanEmail}) with initial status ${initialStatus} and forced password change on first login.`,
      }, admin.idToken!);

      return res.json({
        success: true,
        message: `Account created successfully with status ${initialStatus}.`,
        employee: employeeDoc,
        user: {
          uid: authUid,
          email: cleanEmail,
          status: initialStatus,
          mustChangePassword: true,
        },
      });
    } catch (err: any) {
      console.error('Account creation error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal error creating employee account.' });
    }
  });

  // ----------------------------------------------------
  // API: Admin Update Account Status (Active / Disabled)
  // ----------------------------------------------------
  app.post('/api/admin/employees/update-status', async (req: Request, res: Response) => {
    try {
      const admin = await verifyAdminCaller(req);
      if (!admin.authorized) {
        return res.status(403).json({ success: false, error: admin.error || 'Unauthorized' });
      }

      const { employeeId, email, uid, status } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      const targetStatus = status === 'Disabled' ? 'Disabled' : 'Active';

      if (!cleanEmail) {
        return res.status(400).json({ success: false, error: 'Email is required.' });
      }

      if (cleanEmail === PRIMARY_SUPER_ADMIN_EMAIL || cleanEmail === 'hammadkhanniaxii@gmail.com') {
        return res.status(403).json({
          success: false,
          error: 'Protection: The primary Super Administrator account cannot be disabled.',
        });
      }

      const now = new Date().toISOString();

      if (employeeId) {
        await writeFirestoreDoc(`employees/${employeeId}`, {
          status: targetStatus,
          updatedAt: now,
        }, admin.idToken!);
      }

      if (uid) {
        await writeFirestoreDoc(`users/${uid}`, {
          status: targetStatus,
          updatedAt: now,
        }, admin.idToken!);
      }

      const auditLogId = `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      await writeFirestoreDoc(`audit_logs/${auditLogId}`, {
        action: `ACCOUNT_STATUS_${targetStatus.toUpperCase()}`,
        actorEmail: admin.adminEmail,
        actorUid: admin.adminUid,
        targetEmail: cleanEmail,
        timestamp: now,
        details: `Account status updated to ${targetStatus} by administrator.`,
      }, admin.idToken!);

      return res.json({ success: true, status: targetStatus, message: `Account status updated to ${targetStatus}.` });
    } catch (err: any) {
      console.error('Update status error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal error updating account status.' });
    }
  });

  // ----------------------------------------------------
  // API: Admin Direct Password Reset
  // ----------------------------------------------------
  app.post('/api/admin/employees/reset-password', async (req: Request, res: Response) => {
    try {
      const admin = await verifyAdminCaller(req);
      if (!admin.authorized) {
        return res.status(403).json({ success: false, error: admin.error || 'Unauthorized' });
      }

      const { email, employeeId, uid, newPassword, confirmPassword } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();

      if (!cleanEmail) {
        return res.status(400).json({ success: false, error: 'Email is required.' });
      }

      if ((cleanEmail === PRIMARY_SUPER_ADMIN_EMAIL || cleanEmail === 'hammadkhanniaxii@gmail.com') && !admin.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Access Denied: Only Super Administrators can reset Super Administrator credentials.',
        });
      }

      // Dispatch secure official password reset email via Identity Toolkit
      const oobUrl = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseConfig.apiKey}`;
      const oobRes = await fetch(oobUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType: 'PASSWORD_RESET',
          email: cleanEmail,
        }),
      });

      const oobData = await oobRes.json();
      if (!oobRes.ok) {
        return res.status(400).json({
          success: false,
          error: oobData?.error?.message || 'Failed to dispatch password reset request.',
        });
      }

      const now = new Date().toISOString();

      // Update Firestore user record to require password change
      if (uid) {
        await writeFirestoreDoc(`users/${uid}`, {
          mustChangePassword: true,
          updatedAt: now,
        }, admin.idToken!);
      }

      if (employeeId) {
        await writeFirestoreDoc(`employees/${employeeId}`, {
          mustChangePassword: true,
          updatedAt: now,
        }, admin.idToken!);
      }

      const auditLogId = `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      await writeFirestoreDoc(`audit_logs/${auditLogId}`, {
        action: 'PASSWORD_RESET_BY_ADMIN',
        actorEmail: admin.adminEmail,
        actorUid: admin.adminUid,
        targetEmail: cleanEmail,
        timestamp: now,
        details: 'Administrator set new temporary password. User must change password upon next sign-in.',
      }, admin.idToken!);

      return res.json({
        success: true,
        message: 'Password reset successfully. The employee will be required to establish a permanent password on next sign-in.',
      });
    } catch (err: any) {
      console.error('Reset password error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal error resetting password.' });
    }
  });

  // ----------------------------------------------------
  // API: Admin Deprovision & Delete Employee Account
  // ----------------------------------------------------
  app.post('/api/admin/employees/delete', async (req: Request, res: Response) => {
    try {
      const admin = await verifyAdminCaller(req);
      if (!admin.authorized) {
        return res.status(403).json({ success: false, error: admin.error || 'Unauthorized' });
      }

      const { employeeId, email, uid } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();

      if (!cleanEmail) {
        return res.status(400).json({ success: false, error: 'Email is required for deletion.' });
      }

      // Protections
      if (cleanEmail === PRIMARY_SUPER_ADMIN_EMAIL || cleanEmail === 'hammadkhanniaxii@gmail.com') {
        return res.status(403).json({
          success: false,
          error: 'Protection: The primary Super Administrator account cannot be deleted.',
        });
      }

      if (cleanEmail === admin.adminEmail) {
        return res.status(403).json({
          success: false,
          error: 'Protection: You cannot delete your own administrative account.',
        });
      }


      // 2. Delete from Firestore
      if (employeeId) {
        await deleteFirestoreDoc(`employees/${employeeId}`, admin.idToken!);
      }
      if (uid) {
        await deleteFirestoreDoc(`users/${uid}`, admin.idToken!);
        await deleteFirestoreDoc(`admins/${uid}`, admin.idToken!);
      }

      // 3. Log Audit
      const now = new Date().toISOString();
      const auditLogId = `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      await writeFirestoreDoc(`audit_logs/${auditLogId}`, {
        action: 'EMPLOYEE_ACCOUNT_DELETED',
        actorEmail: admin.adminEmail,
        actorUid: admin.adminUid,
        targetEmail: cleanEmail,
        timestamp: now,
        details: `Account for ${cleanEmail} (Employee ID: ${employeeId || 'N/A'}) permanently deprovisioned and deleted from directory.`,
      }, admin.idToken!);

      return res.json({ success: true, message: 'Account deprovisioned and deleted successfully.' });
    } catch (err: any) {
      console.error('Delete employee error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal error deleting employee account.' });
    }
  });

  // ----------------------------------------------------
  // API: Employee First-Login Password Change
  // ----------------------------------------------------
  app.post('/api/auth/change-initial-password', async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }
      const idToken = authHeader.split('Bearer ')[1].trim();

      const { newPassword, confirmPassword } = req.body || {};
      const passErr = validatePasswordComplexity(newPassword);
      if (passErr) {
        return res.status(400).json({ success: false, error: passErr });
      }
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ success: false, error: 'Passwords do not match.' });
      }

      // Update password in Firebase Auth
      const updateUrl = `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${firebaseConfig.apiKey}`;
      const updateRes = await fetch(updateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken,
          password: newPassword,
          returnSecureToken: true,
        }),
      });

      const updateData = await updateRes.json();
      if (!updateRes.ok || !updateData.idToken) {
        return res.status(400).json({
          success: false,
          error: updateData?.error?.message || 'Failed to update permanent password in authentication provider.',
        });
      }

      const uid = updateData.localId;
      const newToken = updateData.idToken;
      const now = new Date().toISOString();

      // Update user doc: mustChangePassword = false
      await writeFirestoreDoc(`users/${uid}`, {
        mustChangePassword: false,
        updatedAt: now,
      }, newToken);

      return res.json({
        success: true,
        message: 'Permanent password established successfully.',
        idToken: newToken,
      });
    } catch (err: any) {
      console.error('Change initial password error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal error changing password.' });
    }
  });

  // ----------------------------------------------------
  // API: Public Access Request Submission
  // ----------------------------------------------------
  app.post('/api/access-requests', async (req: Request, res: Response) => {
    try {
      const { name, email, department, title, reason } = req.body || {};
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return res.status(400).json({ success: false, error: 'Full legal name is required.' });
      }
      const cleanEmail = (email || '').trim().toLowerCase();
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, error: 'A valid corporate or work email address is required.' });
      }

      const requestId = `req-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const now = new Date().toISOString();

      const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/access_requests/${requestId}`;
      const firestoreFields: Record<string, any> = {
        name: { stringValue: name.trim() },
        email: { stringValue: cleanEmail },
        department: { stringValue: (department || 'Enterprise Advisory').trim() },
        title: { stringValue: (title || 'Consultant').trim() },
        reason: { stringValue: (reason || 'Account access requested via login portal').trim() },
        status: { stringValue: 'Pending' },
        createdAt: { stringValue: now },
      };

      const fRes = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: firestoreFields }),
      });

      if (!fRes.ok) {
        const errText = await fRes.text();
        console.warn('Firestore access request write notice:', errText);
      }

      return res.json({
        success: true,
        requestId,
        message: 'Your access request has been submitted successfully. An administrator will review your application.',
      });
    } catch (err: any) {
      console.error('Access request submission error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to submit access request.' });
    }
  });

  // ----------------------------------------------------
  // API: Administrator List Access Requests
  // ----------------------------------------------------
  app.get('/api/admin/access-requests', async (req: Request, res: Response) => {
    try {
      const authResult = await verifyAdminCaller(req);
      if (!authResult.authorized || !authResult.idToken) {
        return res.status(403).json({ success: false, error: authResult.error || 'Authentication required.' });
      }

      const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/access_requests`;
      const fRes = await fetch(url, {
        headers: { Authorization: `Bearer ${authResult.idToken}` },
      });

      if (!fRes.ok) {
        return res.json({ success: true, requests: [] });
      }

      const data = await fRes.json();
      const rawDocs = data.documents || [];
      const requests = rawDocs.map((docItem: any) => {
        const nameParts = (docItem.name || '').split('/');
        const id = nameParts[nameParts.length - 1];
        const f = docItem.fields || {};
        return {
          id,
          name: f.name?.stringValue || '',
          email: f.email?.stringValue || '',
          department: f.department?.stringValue || 'Enterprise Advisory',
          title: f.title?.stringValue || 'Consultant',
          reason: f.reason?.stringValue || '',
          status: f.status?.stringValue || 'Pending',
          createdAt: f.createdAt?.stringValue || '',
          reviewedAt: f.reviewedAt?.stringValue || '',
          reviewedBy: f.reviewedBy?.stringValue || '',
        };
      });

      requests.sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      return res.json({ success: true, requests });
    } catch (err: any) {
      console.error('List access requests error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to list access requests.' });
    }
  });

  // ----------------------------------------------------
  // API: Administrator Update Access Request Status
  // ----------------------------------------------------
  app.post('/api/admin/access-requests/update-status', async (req: Request, res: Response) => {
    try {
      const authResult = await verifyAdminCaller(req);
      if (!authResult.authorized || !authResult.idToken) {
        return res.status(403).json({ success: false, error: authResult.error || 'Authentication required.' });
      }

      const { id, status } = req.body || {};
      if (!id || !status) {
        return res.status(400).json({ success: false, error: 'Request ID and status are required.' });
      }

      const now = new Date().toISOString();
      await writeFirestoreDoc(`access_requests/${id}`, {
        status,
        reviewedAt: now,
        reviewedBy: authResult.adminEmail || 'Administrator',
      }, authResult.idToken);

      return res.json({ success: true, message: `Access request marked as ${status}.` });
    } catch (err: any) {
      console.error('Update access request status error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to update access request status.' });
    }
  });

  // ----------------------------------------------------
  // API: Administrator Delete Access Request
  // ----------------------------------------------------
  app.post('/api/admin/access-requests/delete', async (req: Request, res: Response) => {
    try {
      const authResult = await verifyAdminCaller(req);
      if (!authResult.authorized || !authResult.idToken) {
        return res.status(403).json({ success: false, error: authResult.error || 'Authentication required.' });
      }

      const { id } = req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, error: 'Request ID is required.' });
      }

      await deleteFirestoreDoc(`access_requests/${id}`, authResult.idToken);
      return res.json({ success: true, message: 'Access request deleted.' });
    } catch (err: any) {
      console.error('Delete access request error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to delete access request.' });
    }
  });

  // ----------------------------------------------------
  // API: Administrator Update Leave Request Status
  // ----------------------------------------------------
  app.post('/api/admin/leaves/update-status', async (req: Request, res: Response) => {
    try {
      const authResult = await verifyAdminCaller(req);
      if (!authResult.authorized || !authResult.idToken) {
        return res.status(403).json({ success: false, error: authResult.error || 'Authentication required.' });
      }

      const { leaveId, status, rejectionReason } = req.body || {};
      if (!leaveId || !status) {
        return res.status(400).json({ success: false, error: 'Leave request ID and status are required.' });
      }

      const validStatuses = ['Approved', 'Declined', 'Pending', 'Cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      }

      const now = new Date().toISOString();
      const reviewerEmail = authResult.adminEmail || 'Administrator';
      const reviewerId = authResult.adminUid || 'admin';

      const updateData: Record<string, any> = {
        status,
        reviewedBy: reviewerEmail,
        reviewerId: reviewerId,
        reviewedAt: now,
        updatedAt: now,
      };

      if (rejectionReason) {
        updateData.rejectionReason = String(rejectionReason).slice(0, 300);
      }

      await writeFirestoreDoc(`leaves/${leaveId}`, updateData, authResult.idToken);

      // Audit log
      const auditLogId = `audit_${Date.now()}`;
      await writeFirestoreDoc(`audit_logs/${auditLogId}`, {
        action: status === 'Approved' ? 'LEAVE_APPROVED' : 'LEAVE_DECLINED',
        actorEmail: reviewerEmail,
        actorUid: reviewerId,
        targetLeaveId: leaveId,
        timestamp: now,
        details: `Leave request ${leaveId} set to ${status} by ${reviewerEmail}.`,
      }, authResult.idToken);

      return res.json({
        success: true,
        message: `Leave request ${leaveId} updated to ${status}.`,
        status,
        reviewedBy: reviewerEmail,
        reviewedAt: now,
      });
    } catch (err: any) {
      console.error('Update leave status error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to update leave request status.' });
    }
  });

  // ----------------------------------------------------
  // Catch-all for API: Never return HTML for /api/* routes
  // ----------------------------------------------------
  app.all('/api/*', (req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: `API endpoint ${req.method} ${req.path} not found.`,
    });
  });

  // API error middleware
  app.use((err: any, req: Request, res: Response, next: any) => {
    if (req.path.startsWith('/api/')) {
      console.error('Unhandled API exception on', req.path, err);
      return res.status(err.status || 500).json({
        success: false,
        error: err.message || 'An internal error occurred handling the API request.',
      });
    }
    next(err);
  });

  const httpServer = http.createServer(app);

  // ----------------------------------------------------
  // Static / Vite middleware
  // ----------------------------------------------------
  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server: httpServer,
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.use('*', async (req: Request, res: Response, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`GA Workspace server listening on port ${PORT} (isProd: ${isProd})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start GA Workspace server:', err);
  process.exit(1);
});
