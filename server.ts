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

// ----------------------------------------------------
// Persistent Invitation Store
// ----------------------------------------------------
const DATA_DIR = path.resolve(__dirname, 'data');
const INVITATIONS_FILE = path.join(DATA_DIR, 'invitations.json');

function getInvitations(): Record<string, any> {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(INVITATIONS_FILE)) {
      fs.writeFileSync(INVITATIONS_FILE, JSON.stringify({}), 'utf-8');
      return {};
    }
    return JSON.parse(fs.readFileSync(INVITATIONS_FILE, 'utf-8'));
  } catch (err) {
    console.error('Error reading invitations store:', err);
    return {};
  }
}

function saveInvitations(invites: Record<string, any>) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(INVITATIONS_FILE, JSON.stringify(invites, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving invitations store:', err);
  }
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
  // API: Admin Provision Employee Account & Send Invitation
  // ----------------------------------------------------
  app.post('/api/admin/employees/provision', async (req: Request, res: Response) => {
    try {
      const admin = await verifyAdminCaller(req);
      if (!admin.authorized) {
        return res.status(403).json({ success: false, error: admin.error || 'Unauthorized' });
      }

      const { name, email, employeeId, department, title, role, sendSetupEmail } = req.body || {};

      if (!name || typeof name !== 'string' || name.trim().length < 3) {
        return res.status(400).json({ success: false, error: 'Full name is required (minimum 3 characters).' });
      }

      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, error: 'A valid work email address is required.' });
      }

      const selectedRole = role || 'employee';
      if (selectedRole === 'super_admin' && !admin.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Access Denied: Only Super Administrators can provision another Super Administrator.',
        });
      }

      // Check if employee already exists in directory
      const finalEmployeeId = employeeId && String(employeeId).trim()
        ? String(employeeId).trim()
        : `GA-${Math.floor(100 + Math.random() * 900)}`;

      const now = new Date().toISOString();
      const tempPassword = crypto.randomBytes(12).toString('hex') + 'Aa1!';
      let authUid: string | null = null;
      let userAlreadyExisted = false;

      // 1. Provision account in Firebase Authentication
      try {
        const signUpUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`;
        const signUpRes = await fetch(signUpUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            password: tempPassword,
            returnSecureToken: true,
          }),
        });

        const signUpData = await signUpRes.json();
        if (signUpRes.ok && signUpData.localId) {
          authUid = signUpData.localId;
        } else if (signUpData?.error?.message === 'EMAIL_EXISTS') {
          userAlreadyExisted = true;
        } else {
          console.warn('Firebase Auth signUp returned:', signUpData);
        }
      } catch (authErr: any) {
        console.error('Firebase Auth provisioning warning:', authErr);
      }

      // 2. Generate secure 48-hour invitation token
      const invitationToken = crypto.randomBytes(32).toString('hex');
      const invitationId = 'inv_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
      const expiresAt = Date.now() + 48 * 60 * 60 * 1000; // 48 hours

      const reqProto = req.headers['x-forwarded-proto'] || ((req.socket as any).encrypted ? 'https' : req.protocol || 'http');
      const reqHost = req.headers['x-forwarded-host'] || req.headers.host;
      const origin = `${reqProto}://${reqHost}`;
      const invitationLink = `${origin}/accept-invitation?token=${invitationToken}&email=${encodeURIComponent(cleanEmail)}`;

      // 3. Dispatch setup email via Firebase Auth built-in provider
      let emailDispatched = false;
      let emailStatusMessage = 'Setup email disabled';
      if (sendSetupEmail !== false) {
        try {
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
          if (oobRes.ok && oobData.email) {
            emailDispatched = true;
            emailStatusMessage = 'Dispatched to delivery queue by Firebase Auth';
          } else {
            emailStatusMessage = oobData?.error?.message || 'Firebase Auth email dispatcher rejected the request';
          }
        } catch (err: any) {
          emailStatusMessage = err.message || 'Error invoking Firebase Auth email dispatcher';
        }
      }

      // 4. Save persistent invitation record
      const invites = getInvitations();
      invites[cleanEmail] = {
        id: invitationId,
        token: invitationToken,
        email: cleanEmail,
        name: name.trim(),
        employeeId: finalEmployeeId,
        department: department ? String(department).trim() : 'Enterprise Advisory',
        title: title ? String(title).trim() : 'Consultant',
        role: selectedRole,
        tempPassword,
        authUid: authUid || null,
        status: 'Pending Invitation',
        expiresAt,
        createdAt: now,
        createdBy: admin.adminEmail,
      };
      saveInvitations(invites);

      // 5. Persist Firestore documents using Admin's idToken
      const adminToken = admin.idToken!;
      const cleanEmployeeDoc = {
        id: finalEmployeeId,
        employeeId: finalEmployeeId,
        name: name.trim(),
        email: cleanEmail,
        department: department ? String(department).trim() : 'Enterprise Advisory',
        title: title ? String(title).trim() : 'Consultant',
        role: selectedRole,
        status: 'Pending Invitation',
        createdAt: now,
        updatedAt: now,
      };

      try {
        await writeFirestoreDoc(`employees/${finalEmployeeId}`, cleanEmployeeDoc, adminToken);
      } catch (err) {
        console.error('Error writing employee doc to Firestore:', err);
      }

      if (authUid) {
        try {
          await writeFirestoreDoc(`users/${authUid}`, {
            id: authUid,
            employeeId: finalEmployeeId,
            name: name.trim(),
            email: cleanEmail,
            department: department ? String(department).trim() : 'Enterprise Advisory',
            title: title ? String(title).trim() : 'Consultant',
            role: selectedRole,
            status: 'Pending Invitation',
            createdAt: now,
            updatedAt: now,
          }, adminToken);

          if (selectedRole === 'super_admin' || selectedRole === 'hr_admin') {
            await writeFirestoreDoc(`admins/${authUid}`, {
              email: cleanEmail,
              role: selectedRole,
              grantedAt: now,
              grantedBy: admin.adminEmail,
            }, adminToken);
          }
        } catch (err) {
          console.error('Error writing user/admin doc to Firestore:', err);
        }
      }

      try {
        await writeFirestoreDoc(`invitations/${invitationId}`, {
          id: invitationId,
          email: cleanEmail,
          name: name.trim(),
          role: selectedRole,
          department: department ? String(department).trim() : 'Enterprise Advisory',
          title: title ? String(title).trim() : 'Consultant',
          employeeId: finalEmployeeId,
          status: 'pending',
          expiresAt: new Date(expiresAt).toISOString(),
          createdAt: now,
          createdBy: admin.adminEmail,
        }, adminToken);
      } catch (err) {
        console.error('Error writing invitation doc to Firestore:', err);
      }

      try {
        const auditLogId = `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        await writeFirestoreDoc(`audit_logs/${auditLogId}`, {
          action: 'EMPLOYEE_PROVISIONED',
          actorEmail: admin.adminEmail,
          actorUid: admin.adminUid,
          targetEmail: cleanEmail,
          timestamp: now,
          details: `Provisioned account for ${name.trim()} (${selectedRole}) with status Pending Invitation.`,
        }, adminToken);
      } catch (err) {
        console.error('Error logging audit event:', err);
      }

      return res.json({
        success: true,
        employee: cleanEmployeeDoc,
        invitation: {
          id: invitationId,
          token: invitationToken,
          invitationLink,
          expiresAt,
          emailDispatched,
          emailStatusMessage,
          userAlreadyExisted,
        },
      });
    } catch (err: any) {
      console.error('Provisioning error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal error provisioning account.' });
    }
  });

  // ----------------------------------------------------
  // API: Resend Invitation Link
  // ----------------------------------------------------
  app.post('/api/admin/employees/resend-invitation', async (req: Request, res: Response) => {
    try {
      const admin = await verifyAdminCaller(req);
      if (!admin.authorized) {
        return res.status(403).json({ success: false, error: admin.error || 'Unauthorized' });
      }

      const { email } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail) {
        return res.status(400).json({ success: false, error: 'Email is required to resend invitation.' });
      }

      const invites = getInvitations();
      let record = invites[cleanEmail];

      const newToken = crypto.randomBytes(32).toString('hex');
      const newExpiry = Date.now() + 48 * 60 * 60 * 1000;
      const reqProto = req.headers['x-forwarded-proto'] || ((req.socket as any).encrypted ? 'https' : req.protocol || 'http');
      const reqHost = req.headers['x-forwarded-host'] || req.headers.host;
      const origin = `${reqProto}://${reqHost}`;
      const newInvitationLink = `${origin}/accept-invitation?token=${newToken}&email=${encodeURIComponent(cleanEmail)}`;

      if (record) {
        record.token = newToken;
        record.expiresAt = newExpiry;
        record.status = 'Pending Invitation';
        record.updatedAt = new Date().toISOString();
        invites[cleanEmail] = record;
      } else {
        record = {
          id: 'inv_' + Date.now().toString(36),
          token: newToken,
          email: cleanEmail,
          status: 'Pending Invitation',
          expiresAt: newExpiry,
          createdAt: new Date().toISOString(),
          createdBy: admin.adminEmail,
        };
        invites[cleanEmail] = record;
      }
      saveInvitations(invites);

      // Attempt Firebase Auth OOB email dispatch
      let emailDispatched = false;
      let emailStatusMessage = '';
      try {
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
        if (oobRes.ok && oobData.email) {
          emailDispatched = true;
          emailStatusMessage = 'Dispatched to delivery queue by Firebase Auth';
        } else {
          emailStatusMessage = oobData?.error?.message || 'Firebase Auth email dispatcher rejected the request';
        }
      } catch (err: any) {
        emailStatusMessage = err.message || 'Error invoking email dispatcher';
      }

      return res.json({
        success: true,
        invitationLink: newInvitationLink,
        expiresAt: newExpiry,
        emailDispatched,
        emailStatusMessage,
      });
    } catch (err: any) {
      console.error('Resend error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal error resending invitation.' });
    }
  });

  // ----------------------------------------------------
  // API: Revoke Pending Invitation
  // ----------------------------------------------------
  app.post('/api/admin/employees/revoke-invitation', async (req: Request, res: Response) => {
    try {
      const admin = await verifyAdminCaller(req);
      if (!admin.authorized) {
        return res.status(403).json({ success: false, error: admin.error || 'Unauthorized' });
      }

      const { email, employeeId } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!cleanEmail) {
        return res.status(400).json({ success: false, error: 'Email is required to revoke invitation.' });
      }

      const invites = getInvitations();
      if (invites[cleanEmail]) {
        invites[cleanEmail].status = 'Revoked';
        invites[cleanEmail].revokedAt = new Date().toISOString();
        invites[cleanEmail].revokedBy = admin.adminEmail;
        saveInvitations(invites);
      }

      // Update employee record status to Deactivated in Firestore
      if (employeeId && admin.idToken) {
        try {
          await writeFirestoreDoc(`employees/${employeeId}`, {
            status: 'Deactivated',
            updatedAt: new Date().toISOString(),
          }, admin.idToken);
        } catch (err) {
          console.warn('Firestore employee deactivation warning:', err);
        }
      }

      return res.json({ success: true, message: 'Invitation revoked successfully.' });
    } catch (err: any) {
      console.error('Revoke error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal error revoking invitation.' });
    }
  });

  // ----------------------------------------------------
  // API: Get Admin Invitations List
  // ----------------------------------------------------
  app.get('/api/admin/invitations', async (req: Request, res: Response) => {
    try {
      const admin = await verifyAdminCaller(req);
      if (!admin.authorized) {
        return res.status(403).json({ success: false, error: admin.error || 'Unauthorized' });
      }

      const reqProto = req.headers['x-forwarded-proto'] || ((req.socket as any).encrypted ? 'https' : req.protocol || 'http');
      const reqHost = req.headers['x-forwarded-host'] || req.headers.host;
      const origin = `${reqProto}://${reqHost}`;

      const invites = getInvitations();
      const list = Object.values(invites).map((inv: any) => ({
        id: inv.id,
        email: inv.email,
        name: inv.name,
        role: inv.role,
        department: inv.department,
        title: inv.title,
        employeeId: inv.employeeId,
        status: inv.status,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        createdBy: inv.createdBy,
        invitationLink: `${origin}/accept-invitation?token=${inv.token}&email=${encodeURIComponent(inv.email)}`,
      }));

      return res.json({ success: true, invitations: list });
    } catch (err: any) {
      console.error('Get invitations error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Internal error retrieving invitations.' });
    }
  });

  // ----------------------------------------------------
  // API: Public - Validate Invitation Token
  // ----------------------------------------------------
  app.post('/api/auth/validate-invitation', async (req: Request, res: Response) => {
    try {
      const { token, email } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      const cleanToken = String(token || '').trim();

      if (!cleanEmail || !cleanToken) {
        return res.status(400).json({ valid: false, error: 'Invitation token and email are required.' });
      }

      const invites = getInvitations();
      const record = invites[cleanEmail];

      if (!record) {
        return res.status(404).json({
          valid: false,
          error: 'No invitation was found for this email address. Please request a new invitation link from your administrator.',
        });
      }

      if (record.token !== cleanToken) {
        return res.status(401).json({
          valid: false,
          error: 'Invalid invitation security token. Please check that you clicked the complete link.',
        });
      }

      if (record.status === 'accepted') {
        return res.status(410).json({
          valid: false,
          error: 'This invitation has already been accepted and your password is set. Please sign in via the login portal.',
        });
      }

      if (record.status === 'Revoked') {
        return res.status(410).json({
          valid: false,
          error: 'This invitation has been revoked by an administrator. Please reach out to your team lead.',
        });
      }

      if (Date.now() > record.expiresAt) {
        return res.status(410).json({
          valid: false,
          error: 'This invitation link expired after 48 hours. Please request your administrator to resend the invitation.',
        });
      }

      return res.json({
        valid: true,
        email: record.email,
        name: record.name,
        role: record.role,
        department: record.department,
        title: record.title,
        employeeId: record.employeeId,
        expiresAt: record.expiresAt,
      });
    } catch (err: any) {
      console.error('Validation error:', err);
      return res.status(500).json({ valid: false, error: err.message || 'Error validating invitation.' });
    }
  });

  // ----------------------------------------------------
  // API: Public - Accept Invitation & Establish Permanent Password
  // ----------------------------------------------------
  app.post('/api/auth/accept-invitation', async (req: Request, res: Response) => {
    try {
      const { token, email, newPassword, confirmPassword } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      const cleanToken = String(token || '').trim();

      if (!cleanEmail || !cleanToken) {
        return res.status(400).json({ success: false, error: 'Invitation token and email are required.' });
      }

      // Password Complexity Validation
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

      const invites = getInvitations();
      const record = invites[cleanEmail];

      if (!record || record.token !== cleanToken) {
        return res.status(401).json({ success: false, error: 'Invalid or missing invitation token.' });
      }
      if (record.status === 'accepted') {
        return res.status(410).json({ success: false, error: 'This invitation has already been used. Please log in.' });
      }
      if (Date.now() > record.expiresAt) {
        return res.status(410).json({ success: false, error: 'This invitation link has expired. Please ask for a new link.' });
      }

      // Update password in Firebase Authentication
      let employeeIdToken: string | null = null;
      let employeeUid: string | null = record.authUid || null;

      // Try signIn with temporary password if available
      if (record.tempPassword) {
        try {
          const signInRes = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: cleanEmail,
                password: record.tempPassword,
                returnSecureToken: true,
              }),
            }
          );
          const signInData = await signInRes.json();
          if (signInRes.ok && signInData.idToken) {
            employeeIdToken = signInData.idToken;
            employeeUid = signInData.localId;
          }
        } catch (e) {
          console.warn('Sign-in with temp password notice:', e);
        }
      }

      // If we got the token via tempPassword, update to the permanent password
      if (employeeIdToken) {
        const updateRes = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${firebaseConfig.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              idToken: employeeIdToken,
              password: newPassword,
              returnSecureToken: true,
            }),
          }
        );
        const updateData = await updateRes.json();
        if (updateRes.ok && updateData.idToken) {
          employeeIdToken = updateData.idToken;
        } else {
          throw new Error(updateData?.error?.message || 'Failed to update password in Firebase Authentication');
        }
      } else {
        // Fallback: Attempt sign-up or reset
        const signUpRes = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: cleanEmail,
              password: newPassword,
              returnSecureToken: true,
            }),
          }
        );
        const signUpData = await signUpRes.json();
        if (signUpRes.ok && signUpData.idToken) {
          employeeIdToken = signUpData.idToken;
          employeeUid = signUpData.localId;
        } else {
          // Attempt sign in with newPassword directly
          const checkSignIn = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: cleanEmail,
                password: newPassword,
                returnSecureToken: true,
              }),
            }
          );
          const checkData = await checkSignIn.json();
          if (checkSignIn.ok && checkData.idToken) {
            employeeIdToken = checkData.idToken;
            employeeUid = checkData.localId;
          } else {
            throw new Error('Unable to update credentials in authentication provider. Please contact support.');
          }
        }
      }

      const now = new Date().toISOString();

      // Transition Status: Update Firestore documents with employee's idToken
      if (employeeIdToken) {
        // Update employee document to Active
        if (record.employeeId) {
          try {
            await writeFirestoreDoc(`employees/${record.employeeId}`, {
              id: record.employeeId,
              employeeId: record.employeeId,
              name: record.name,
              email: cleanEmail,
              department: record.department,
              title: record.title,
              role: record.role,
              status: 'Active',
              updatedAt: now,
            }, employeeIdToken);
          } catch (err) {
            console.warn('Update employee doc to Active warning:', err);
          }
        }

        // Update user document to Active
        if (employeeUid) {
          try {
            await writeFirestoreDoc(`users/${employeeUid}`, {
              id: employeeUid,
              employeeId: record.employeeId,
              name: record.name,
              email: cleanEmail,
              department: record.department,
              title: record.title,
              role: record.role,
              status: 'Active',
              updatedAt: now,
            }, employeeIdToken);
          } catch (err) {
            console.warn('Update user doc to Active warning:', err);
          }
        }

        // Log audit event
        try {
          const auditLogId = `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
          await writeFirestoreDoc(`audit_logs/${auditLogId}`, {
            action: 'INVITATION_ACCEPTED',
            actorEmail: cleanEmail,
            actorUid: employeeUid || 'unknown',
            targetEmail: cleanEmail,
            timestamp: now,
            details: `Employee ${record.name} successfully established password and activated corporate account.`,
          }, employeeIdToken);
        } catch (err) {
          console.warn('Audit log write warning:', err);
        }
      }

      // Mark invitation accepted in persistent store
      record.status = 'accepted';
      record.acceptedAt = now;
      delete record.tempPassword; // Discard temporary secret
      invites[cleanEmail] = record;
      saveInvitations(invites);

      return res.json({
        success: true,
        message: 'Your permanent password has been established successfully. Your account is now Active.',
        email: cleanEmail,
        name: record.name,
        role: record.role,
      });
    } catch (err: any) {
      console.error('Accept invitation failure:', err);
      return res.status(500).json({ success: false, error: err.message || 'Error completing account activation.' });
    }
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
