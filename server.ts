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

// Helper to serialize any JS value into Firestore REST API format
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

// Helper to deserialize Firestore REST API values back into JS values
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

// Helper to deserialize an entire Firestore REST document
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

// Helper to write Firestore documents using REST API with idToken
async function writeFirestoreDoc(pathDoc: string, fields: Record<string, any>, idToken: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${pathDoc}`;
  const firestoreFields: Record<string, any> = {};

  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) {
      firestoreFields[key] = serializeToFirestoreValue(val);
    }
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

// Helper to read a single Firestore document using REST API with idToken
async function readFirestoreDoc(pathDoc: string, idToken: string): Promise<any | null> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/${pathDoc}`;
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

// ----------------------------------------------------
// Helper: Verify User/Employee Caller from Bearer idToken
// ----------------------------------------------------
async function verifyUserCaller(req: Request): Promise<{
  authenticated: boolean;
  error?: string;
  userEmail?: string;
  userId?: string;
  idToken?: string;
  name?: string;
}> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authenticated: false, error: 'Authentication required. Missing Bearer token.' };
  }
  const idToken = authHeader.split('Bearer ')[1].trim();
  if (!idToken) {
    return { authenticated: false, error: 'Empty authorization token provided.' };
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

// Asia/Karachi (PKT, UTC+5) Helpers for server-authoritative timestamps
const SERVER_KARACHI_TZ = 'Asia/Karachi';

function getServerKarachiDate(timestampMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SERVER_KARACHI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestampMs));
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function getServerKarachiTime(timestampMs: number = Date.now()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SERVER_KARACHI_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(timestampMs));
}

function formatDurationHms(totalSec: number): string {
  if (isNaN(totalSec) || totalSec < 0) totalSec = 0;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
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

  // ====================================================
  // ATTENDANCE MANAGEMENT SYSTEM ENDPOINTS
  // Server-authoritative timestamps, Asia/Karachi timezone
  // ====================================================

  // ----------------------------------------------------
  // API: Employee Clock-In
  // ----------------------------------------------------
  app.post('/api/attendance/clock-in', async (req: Request, res: Response) => {
    try {
      const authResult = await verifyUserCaller(req);
      if (!authResult.authenticated || !authResult.idToken || !authResult.userId) {
        return res.status(401).json({ success: false, error: authResult.error || 'Authentication required.' });
      }

      const userId = authResult.userId;
      const nowMs = Date.now();
      const todayKarachi = getServerKarachiDate(nowMs);
      const clockInTimeDisplay = getServerKarachiTime(nowMs);

      // Check existing active session
      const existingActive = await readFirestoreDoc(`attendance/active_${userId}`, authResult.idToken);
      if (existingActive && existingActive.isActive) {
        // If from previous date or > 14h, auto-flag and seal as Missed Clock-Out / Requires Review
        const elapsedSinceIn = Math.max(0, Math.floor((nowMs - (existingActive.clockInTimestamp || nowMs)) / 1000));
        const isOvernightOrStale = existingActive.date !== todayKarachi || elapsedSinceIn > 14 * 3600;

        if (isOvernightOrStale) {
          const staleSessionId = existingActive.sessionId || `ATT-${Math.floor(1000 + Math.random() * 9000)}`;
          const sealedRecord = {
            ...existingActive,
            state: 'Requires Review',
            status: 'Missed Clock-Out',
            isActive: false,
            requiresReview: true,
            isMissedClockout: true,
            clockOutDisplay: 'Unclosed (Auto-Flagged)',
            shiftElapsedSeconds: elapsedSinceIn,
            netWorkingSeconds: Math.max(0, (existingActive.accumulatedWorkingSeconds || 0)),
            workedDisplay: formatDurationHms(existingActive.accumulatedWorkingSeconds || 0),
            updatedAt: new Date(nowMs).toISOString(),
          };
          await writeFirestoreDoc(`attendance/rec_${staleSessionId}`, sealedRecord, authResult.idToken);
          await deleteFirestoreDoc(`attendance/active_${userId}`, authResult.idToken);
        } else {
          return res.status(400).json({
            success: false,
            error: 'You already have an active work session in progress for today.',
            session: existingActive,
          });
        }
      }

      // Generate unique session ID
      const sessionId = `ATT-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

      // Fetch employee info for department/title if available
      let department = 'Enterprise Advisory';
      let title = 'Consultant';
      let employeeName = authResult.name || 'Consultant';
      const userDoc = await readFirestoreDoc(`users/${userId}`, authResult.idToken);
      if (userDoc) {
        if (userDoc.department) department = userDoc.department;
        if (userDoc.title) title = userDoc.title;
        if (userDoc.name) employeeName = userDoc.name;
      }

      const newSession = {
        id: `active_${userId}`,
        sessionId,
        userId,
        employeeName,
        employeeEmail: authResult.userEmail || '',
        department,
        title,
        date: todayKarachi,
        state: 'Working',
        isActive: true,
        clockInTimestamp: nowMs,
        clockInIso: new Date(nowMs).toISOString(),
        clockInDisplay: clockInTimeDisplay,
        clockOutTimestamp: null,
        clockOutIso: null,
        clockOutDisplay: '—',
        shiftElapsedSeconds: 0,
        accumulatedWorkingSeconds: 0,
        totalBreakSeconds: 0,
        breakMinutes: 0,
        currentBreakStart: null,
        lastWorkStartTimestamp: nowMs,
        breaks: [],
        requiresReview: false,
        isMissedClockout: false,
        createdAt: new Date(nowMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
      };

      // Write active session pointer and immutable record
      await writeFirestoreDoc(`attendance/active_${userId}`, newSession, authResult.idToken);
      await writeFirestoreDoc(`attendance/rec_${sessionId}`, newSession, authResult.idToken);

      // Write to attendance/${userId} for backwards compatibility and instant snapshot sync
      await writeFirestoreDoc(`attendance/${userId}`, {
        userId,
        employeeName,
        employeeEmail: authResult.userEmail || '',
        department,
        title,
        date: todayKarachi,
        state: 'Working',
        clockedIn: clockInTimeDisplay,
        worked: '00h 00m',
        breakMinutes: 0,
        clockInTimestamp: nowMs,
        lastWorkStartTimestamp: nowMs,
        lastBreakStartTimestamp: null,
        accumulatedWorkedSeconds: 0,
        breakSeconds: 0,
        workedSeconds: 0,
        currentSessionId: sessionId,
        updatedAt: new Date(nowMs).toISOString(),
      }, authResult.idToken);

      return res.json({
        success: true,
        message: `Clock-in recorded at ${clockInTimeDisplay} (Asia/Karachi).`,
        session: newSession,
      });
    } catch (err: any) {
      console.error('Clock-in error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to record clock-in.' });
    }
  });

  // ----------------------------------------------------
  // API: Employee Start Break
  // ----------------------------------------------------
  app.post('/api/attendance/start-break', async (req: Request, res: Response) => {
    try {
      const authResult = await verifyUserCaller(req);
      if (!authResult.authenticated || !authResult.idToken || !authResult.userId) {
        return res.status(401).json({ success: false, error: authResult.error || 'Authentication required.' });
      }

      const userId = authResult.userId;
      const nowMs = Date.now();

      let activeSession = await readFirestoreDoc(`attendance/active_${userId}`, authResult.idToken);
      if (!activeSession || !activeSession.isActive) {
        const userDoc = await readFirestoreDoc(`attendance/${userId}`, authResult.idToken);
        if (userDoc && (userDoc.state === 'Working' || userDoc.state === 'On break')) {
          activeSession = {
            id: `active_${userId}`,
            sessionId: userDoc.sessionId || userDoc.currentSessionId || `ATT-${Date.now().toString().slice(-6)}`,
            userId,
            employeeName: userDoc.employeeName || authResult.name || 'Member',
            employeeEmail: userDoc.employeeEmail || authResult.userEmail || '',
            department: userDoc.department || 'Enterprise Advisory',
            title: userDoc.title || 'Consultant',
            date: userDoc.date || getServerKarachiDate(nowMs),
            state: userDoc.state,
            isActive: true,
            clockInTimestamp: userDoc.clockInTimestamp || nowMs,
            clockInIso: userDoc.clockInIso || new Date(userDoc.clockInTimestamp || nowMs).toISOString(),
            clockInDisplay: userDoc.clockInDisplay || userDoc.clockedIn || getServerKarachiTime(userDoc.clockInTimestamp || nowMs),
            lastWorkStartTimestamp: userDoc.lastWorkStartTimestamp || nowMs,
            currentBreakStart: userDoc.currentBreakStart || null,
            totalBreakSeconds: userDoc.totalBreakSeconds || userDoc.breakSeconds || 0,
            breakMinutes: userDoc.breakMinutes || 0,
            breaks: Array.isArray(userDoc.breaks) ? userDoc.breaks : [],
            accumulatedWorkingSeconds: userDoc.accumulatedWorkedSeconds || userDoc.accumulatedWorkingSeconds || 0,
            createdAt: userDoc.createdAt || new Date(nowMs).toISOString(),
            updatedAt: new Date(nowMs).toISOString(),
          };
        }
      }
      if (!activeSession || !activeSession.isActive) {
        return res.status(400).json({ success: false, error: 'No active work session found in database to take a break.' });
      }

      if (activeSession.state === 'On break') {
        return res.status(400).json({ success: false, error: 'You are already on an active break.' });
      }

      if (activeSession.state !== 'Working') {
        return res.status(400).json({ success: false, error: `Cannot start break while in state "${activeSession.state}".` });
      }

      // Calculate working stretch up to this moment
      const currentStretch = activeSession.lastWorkStartTimestamp
        ? Math.max(0, Math.floor((nowMs - activeSession.lastWorkStartTimestamp) / 1000))
        : 0;
      const newAccumulatedWorking = (activeSession.accumulatedWorkingSeconds || 0) + currentStretch;

      const updatedSession = {
        ...activeSession,
        state: 'On break',
        accumulatedWorkingSeconds: newAccumulatedWorking,
        lastWorkStartTimestamp: null,
        currentBreakStart: nowMs,
        updatedAt: new Date(nowMs).toISOString(),
      };

      await writeFirestoreDoc(`attendance/active_${userId}`, updatedSession, authResult.idToken);
      if (activeSession.sessionId) {
        await writeFirestoreDoc(`attendance/rec_${activeSession.sessionId}`, updatedSession, authResult.idToken);
      }

      // Update attendance/${userId} for live sync
      await writeFirestoreDoc(`attendance/${userId}`, {
        state: 'On break',
        lastWorkStartTimestamp: null,
        lastBreakStartTimestamp: nowMs,
        accumulatedWorkedSeconds: newAccumulatedWorking,
        updatedAt: new Date(nowMs).toISOString(),
      }, authResult.idToken);

      return res.json({
        success: true,
        message: 'Break session started.',
        session: updatedSession,
      });
    } catch (err: any) {
      console.error('Start break error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to start break.' });
    }
  });

  // ----------------------------------------------------
  // API: Employee End Break / Resume Work
  // ----------------------------------------------------
  app.post('/api/attendance/end-break', async (req: Request, res: Response) => {
    try {
      const authResult = await verifyUserCaller(req);
      if (!authResult.authenticated || !authResult.idToken || !authResult.userId) {
        return res.status(401).json({ success: false, error: authResult.error || 'Authentication required.' });
      }

      const userId = authResult.userId;
      const nowMs = Date.now();

      let activeSession = await readFirestoreDoc(`attendance/active_${userId}`, authResult.idToken);
      if (!activeSession || !activeSession.isActive) {
        const userDoc = await readFirestoreDoc(`attendance/${userId}`, authResult.idToken);
        if (userDoc && (userDoc.state === 'Working' || userDoc.state === 'On break')) {
          activeSession = {
            id: `active_${userId}`,
            sessionId: userDoc.sessionId || userDoc.currentSessionId || `ATT-${Date.now().toString().slice(-6)}`,
            userId,
            employeeName: userDoc.employeeName || authResult.name || 'Member',
            employeeEmail: userDoc.employeeEmail || authResult.userEmail || '',
            department: userDoc.department || 'Enterprise Advisory',
            title: userDoc.title || 'Consultant',
            date: userDoc.date || getServerKarachiDate(nowMs),
            state: userDoc.state,
            isActive: true,
            clockInTimestamp: userDoc.clockInTimestamp || nowMs,
            clockInIso: userDoc.clockInIso || new Date(userDoc.clockInTimestamp || nowMs).toISOString(),
            clockInDisplay: userDoc.clockInDisplay || userDoc.clockedIn || getServerKarachiTime(userDoc.clockInTimestamp || nowMs),
            lastWorkStartTimestamp: userDoc.lastWorkStartTimestamp || nowMs,
            currentBreakStart: userDoc.currentBreakStart || null,
            totalBreakSeconds: userDoc.totalBreakSeconds || userDoc.breakSeconds || 0,
            breakMinutes: userDoc.breakMinutes || 0,
            breaks: Array.isArray(userDoc.breaks) ? userDoc.breaks : [],
            accumulatedWorkingSeconds: userDoc.accumulatedWorkedSeconds || userDoc.accumulatedWorkingSeconds || 0,
            createdAt: userDoc.createdAt || new Date(nowMs).toISOString(),
            updatedAt: new Date(nowMs).toISOString(),
          };
        }
      }
      if (!activeSession || !activeSession.isActive) {
        return res.status(400).json({ success: false, error: 'No active work session found.' });
      }

      if (activeSession.state !== 'On break') {
        return res.status(400).json({ success: false, error: 'No active break session to resume from.' });
      }

      // Calculate completed break duration
      const breakStart = activeSession.currentBreakStart || activeSession.lastBreakStartTimestamp || nowMs;
      const breakDuration = Math.max(0, Math.floor((nowMs - breakStart) / 1000));
      const newTotalBreak = (activeSession.totalBreakSeconds || 0) + breakDuration;

      const breakItem = {
        id: `BRK-${Date.now().toString().slice(-4)}`,
        startTime: breakStart,
        startIso: new Date(breakStart).toISOString(),
        startDisplay: getServerKarachiTime(breakStart),
        endTime: nowMs,
        endIso: new Date(nowMs).toISOString(),
        endDisplay: getServerKarachiTime(nowMs),
        durationSeconds: breakDuration,
        durationDisplay: `${Math.floor(breakDuration / 60)}m ${breakDuration % 60}s`,
      };

      const updatedBreaks = Array.isArray(activeSession.breaks) ? [...activeSession.breaks, breakItem] : [breakItem];

      const updatedSession = {
        ...activeSession,
        state: 'Working',
        currentBreakStart: null,
        lastWorkStartTimestamp: nowMs,
        totalBreakSeconds: newTotalBreak,
        breakMinutes: Math.floor(newTotalBreak / 60),
        breaks: updatedBreaks,
        updatedAt: new Date(nowMs).toISOString(),
      };

      await writeFirestoreDoc(`attendance/active_${userId}`, updatedSession, authResult.idToken);
      if (activeSession.sessionId) {
        await writeFirestoreDoc(`attendance/rec_${activeSession.sessionId}`, updatedSession, authResult.idToken);
      }

      // Update attendance/${userId} for live sync
      await writeFirestoreDoc(`attendance/${userId}`, {
        state: 'Working',
        lastBreakStartTimestamp: null,
        lastWorkStartTimestamp: nowMs,
        breakSeconds: newTotalBreak,
        breakMinutes: Math.floor(newTotalBreak / 60),
        updatedAt: new Date(nowMs).toISOString(),
      }, authResult.idToken);

      return res.json({
        success: true,
        message: 'Work session resumed.',
        session: updatedSession,
      });
    } catch (err: any) {
      console.error('End break error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to resume work.' });
    }
  });

  // ----------------------------------------------------
  // API: Employee Clock-Out
  // ----------------------------------------------------
  app.post('/api/attendance/clock-out', async (req: Request, res: Response) => {
    try {
      const authResult = await verifyUserCaller(req);
      if (!authResult.authenticated || !authResult.idToken || !authResult.userId) {
        return res.status(401).json({ success: false, error: authResult.error || 'Authentication required.' });
      }

      const userId = authResult.userId;
      const nowMs = Date.now();
      const clockOutTimeDisplay = getServerKarachiTime(nowMs);

      let activeSession = await readFirestoreDoc(`attendance/active_${userId}`, authResult.idToken);
      if (!activeSession || !activeSession.isActive) {
        const userDoc = await readFirestoreDoc(`attendance/${userId}`, authResult.idToken);
        if (userDoc && (userDoc.state === 'Working' || userDoc.state === 'On break')) {
          activeSession = {
            id: `active_${userId}`,
            sessionId: userDoc.sessionId || userDoc.currentSessionId || `ATT-${Date.now().toString().slice(-6)}`,
            userId,
            employeeName: userDoc.employeeName || authResult.name || 'Member',
            employeeEmail: userDoc.employeeEmail || authResult.userEmail || '',
            department: userDoc.department || 'Enterprise Advisory',
            title: userDoc.title || 'Consultant',
            date: userDoc.date || getServerKarachiDate(nowMs),
            state: userDoc.state,
            isActive: true,
            clockInTimestamp: userDoc.clockInTimestamp || nowMs,
            clockInIso: userDoc.clockInIso || new Date(userDoc.clockInTimestamp || nowMs).toISOString(),
            clockInDisplay: userDoc.clockInDisplay || userDoc.clockedIn || getServerKarachiTime(userDoc.clockInTimestamp || nowMs),
            lastWorkStartTimestamp: userDoc.lastWorkStartTimestamp || nowMs,
            currentBreakStart: userDoc.currentBreakStart || null,
            totalBreakSeconds: userDoc.totalBreakSeconds || userDoc.breakSeconds || 0,
            breakMinutes: userDoc.breakMinutes || 0,
            breaks: Array.isArray(userDoc.breaks) ? userDoc.breaks : [],
            accumulatedWorkingSeconds: userDoc.accumulatedWorkedSeconds || userDoc.accumulatedWorkingSeconds || 0,
            createdAt: userDoc.createdAt || new Date(nowMs).toISOString(),
            updatedAt: new Date(nowMs).toISOString(),
          };
        }
      }
      if (!activeSession || !activeSession.isActive) {
        return res.status(400).json({ success: false, error: 'No active work session found in database to clock out.' });
      }

      let totalBreakSeconds = activeSession.totalBreakSeconds || 0;
      let breaks = Array.isArray(activeSession.breaks) ? [...activeSession.breaks] : [];
      let accumulatedWorkingSeconds = activeSession.accumulatedWorkingSeconds || 0;

      // Auto-close break if employee is on break when clocking out
      if (activeSession.state === 'On break') {
        const breakStart = activeSession.currentBreakStart || activeSession.lastBreakStartTimestamp || nowMs;
        const breakDuration = Math.max(0, Math.floor((nowMs - breakStart) / 1000));
        totalBreakSeconds += breakDuration;
        breaks.push({
          id: `BRK-${Date.now().toString().slice(-4)}`,
          startTime: breakStart,
          startIso: new Date(breakStart).toISOString(),
          startDisplay: getServerKarachiTime(breakStart),
          endTime: nowMs,
          endIso: new Date(nowMs).toISOString(),
          endDisplay: clockOutTimeDisplay,
          durationSeconds: breakDuration,
          durationDisplay: `${Math.floor(breakDuration / 60)}m ${breakDuration % 60}s`,
        });
      } else if (activeSession.state === 'Working' && activeSession.lastWorkStartTimestamp) {
        const currentStretch = Math.max(0, Math.floor((nowMs - activeSession.lastWorkStartTimestamp) / 1000));
        accumulatedWorkingSeconds += currentStretch;
      }

      const shiftElapsedSeconds = Math.max(0, Math.floor((nowMs - activeSession.clockInTimestamp) / 1000));
      const netWorkingSeconds = Math.max(0, shiftElapsedSeconds - totalBreakSeconds);
      const isExcessiveShift = shiftElapsedSeconds > 14 * 3600;

      const finalStatus = isExcessiveShift
        ? 'Requires Review'
        : (netWorkingSeconds >= 28800 ? 'Compliant' : 'Verified');

      const completedRecord = {
        ...activeSession,
        state: 'Completed',
        status: finalStatus,
        isActive: false,
        clockOutTimestamp: nowMs,
        clockOutIso: new Date(nowMs).toISOString(),
        clockOutDisplay: clockOutTimeDisplay,
        shiftElapsedSeconds,
        totalBreakSeconds,
        breakMinutes: Math.floor(totalBreakSeconds / 60),
        breaks,
        accumulatedWorkingSeconds,
        netWorkingSeconds,
        workedDisplay: formatDurationHms(netWorkingSeconds),
        requiresReview: isExcessiveShift,
        isMissedClockout: isExcessiveShift,
        updatedAt: new Date(nowMs).toISOString(),
      };

      // Archive permanent session record
      const sessionId = activeSession.sessionId || `ATT-${Math.floor(1000 + Math.random() * 9000)}`;
      await writeFirestoreDoc(`attendance/rec_${sessionId}`, completedRecord, authResult.idToken);

      // Remove active pointer
      await deleteFirestoreDoc(`attendance/active_${userId}`, authResult.idToken);

      // Append record to attendance/${userId}.history for immediate client reflection
      const currentDoc = await readFirestoreDoc(`attendance/${userId}`, authResult.idToken);
      const existingHistory = Array.isArray(currentDoc?.history) ? currentDoc.history : [];
      const historyItem = {
        id: sessionId,
        date: activeSession.date,
        clockIn: activeSession.clockInDisplay || '—',
        clockOut: clockOutTimeDisplay,
        worked: formatDurationHms(netWorkingSeconds),
        breakMinutes: Math.floor(totalBreakSeconds / 60),
        status: finalStatus,
        shiftElapsedSeconds,
        netWorkingSeconds,
        breaks,
      };

      await writeFirestoreDoc(`attendance/${userId}`, {
        state: 'Clocked out',
        worked: formatDurationHms(netWorkingSeconds),
        workedSeconds: netWorkingSeconds,
        clockedIn: activeSession.clockInDisplay || '—',
        breakMinutes: Math.floor(totalBreakSeconds / 60),
        history: [historyItem, ...existingHistory],
        lastWorkStartTimestamp: null,
        lastBreakStartTimestamp: null,
        updatedAt: new Date(nowMs).toISOString(),
      }, authResult.idToken);

      return res.json({
        success: true,
        message: `Clock-out recorded at ${clockOutTimeDisplay}. Final working time: ${formatDurationHms(netWorkingSeconds)}.`,
        session: completedRecord,
      });
    } catch (err: any) {
      console.error('Clock-out error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to record clock-out.' });
    }
  });

  // ----------------------------------------------------
  // API: Get Current Employee Active Attendance Session
  // ----------------------------------------------------
  app.get('/api/attendance/active', async (req: Request, res: Response) => {
    try {
      const authResult = await verifyUserCaller(req);
      if (!authResult.authenticated || !authResult.idToken || !authResult.userId) {
        return res.status(401).json({ success: false, error: authResult.error || 'Authentication required.' });
      }

      const userId = authResult.userId;
      let activeSession = await readFirestoreDoc(`attendance/active_${userId}`, authResult.idToken);
      if (!activeSession || !activeSession.isActive) {
        const userDoc = await readFirestoreDoc(`attendance/${userId}`, authResult.idToken);
        if (userDoc && (userDoc.state === 'Working' || userDoc.state === 'On break')) {
          activeSession = {
            ...userDoc,
            isActive: true,
          };
        }
      }
      if (!activeSession || !activeSession.isActive) {
        return res.json({ success: true, active: false });
      }

      const nowMs = Date.now();
      const shiftElapsedSeconds = Math.max(0, Math.floor((nowMs - (activeSession.clockInTimestamp || nowMs)) / 1000));
      const currentBreakExtra = activeSession.state === 'On break' && activeSession.currentBreakStart
        ? Math.max(0, Math.floor((nowMs - activeSession.currentBreakStart) / 1000))
        : 0;
      const totalBreakSeconds = (activeSession.totalBreakSeconds || 0) + currentBreakExtra;
      const netWorkingSeconds = Math.max(0, shiftElapsedSeconds - totalBreakSeconds);

      const isStale = shiftElapsedSeconds > 14 * 3600 || activeSession.date < getServerKarachiDate(nowMs);

      return res.json({
        success: true,
        active: true,
        session: {
          ...activeSession,
          liveShiftElapsedSeconds: shiftElapsedSeconds,
          liveTotalBreakSeconds: totalBreakSeconds,
          liveNetWorkingSeconds: netWorkingSeconds,
          liveWorkedDisplay: formatDurationHms(netWorkingSeconds),
          requiresReview: isStale,
          isMissedClockout: isStale,
        },
      });
    } catch (err: any) {
      console.error('Get active session error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to fetch active attendance session.' });
    }
  });

  // ----------------------------------------------------
  // API: Get Employee Attendance History
  // ----------------------------------------------------
  app.get('/api/attendance/history', async (req: Request, res: Response) => {
    try {
      const authResult = await verifyUserCaller(req);
      if (!authResult.authenticated || !authResult.idToken || !authResult.userId) {
        return res.status(401).json({ success: false, error: authResult.error || 'Authentication required.' });
      }

      const userId = authResult.userId;
      const userAttDoc = await readFirestoreDoc(`attendance/${userId}`, authResult.idToken);
      const historyList = Array.isArray(userAttDoc?.history) ? userAttDoc.history : [];

      return res.json({
        success: true,
        history: historyList,
      });
    } catch (err: any) {
      console.error('Get history error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to fetch attendance history.' });
    }
  });

  // ----------------------------------------------------
  // API: Admin Company-wide Attendance Overview & Reports
  // ----------------------------------------------------
  app.get('/api/admin/attendance/all', async (req: Request, res: Response) => {
    try {
      const authResult = await verifyAdminCaller(req);
      if (!authResult.authorized || !authResult.idToken) {
        return res.status(403).json({ success: false, error: authResult.error || 'Administrative permissions required.' });
      }

      const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/attendance?pageSize=300`;
      const fRes = await fetch(url, {
        headers: { Authorization: `Bearer ${authResult.idToken}` },
      });

      if (!fRes.ok) {
        return res.json({ success: true, records: [], summary: { activeStaff: 0, clockedInToday: 0, onBreakToday: 0, missedClockouts: 0, totalHoursToday: 0 } });
      }

      const data = await fRes.json();
      const rawDocs = data.documents || [];
      const sessionMap = new Map<string, any>();
      const nowMs = Date.now();
      const todayKarachi = getServerKarachiDate(nowMs);

      // Ingest and reconcile from all three document types: rec_*, active_*, and attendance/${userId}
      for (const docItem of rawDocs) {
        const item = deserializeFirestoreDoc(docItem);
        if (!item) continue;

        if (item.id.startsWith('rec_')) {
          const sId = item.sessionId || item.id.replace('rec_', '');
          sessionMap.set(sId, { ...item, id: sId, sessionId: sId });
        } else if (item.id.startsWith('active_')) {
          const sId = item.sessionId || item.id;
          if (item.isActive) {
            sessionMap.set(sId, { ...item, id: sId });
          }
        } else {
          // Master employee record attendance/${userId}
          const uId = item.userId || item.id;
          // 1. Process root session if valid
          if (item.date && (item.clockInDisplay !== '—' || item.clockInTimestamp || item.isActive)) {
            const rootSessionId = item.sessionId || `SES-${uId}-${item.date}`;
            // If not already archived in rec_ or if currently active, register it
            if (!sessionMap.has(rootSessionId) || item.isActive) {
              sessionMap.set(rootSessionId, {
                ...item,
                id: rootSessionId,
                sessionId: rootSessionId,
                userId: uId,
              });
            }
          }

          // 2. Process all past sessions in user history
          if (Array.isArray(item.history)) {
            for (const h of item.history) {
              const hKey = h.sessionId || h.id || `HIST-${uId}-${h.date}-${h.clockIn || '0'}`;
              if (!sessionMap.has(hKey)) {
                sessionMap.set(hKey, {
                  ...h,
                  id: hKey,
                  sessionId: h.sessionId || h.id || hKey,
                  userId: uId,
                  employeeName: item.employeeName || h.employeeName || 'Member',
                  employeeEmail: item.employeeEmail || h.employeeEmail || '',
                  department: item.department || h.department || 'Enterprise Advisory',
                  title: item.title || h.title || 'Consultant',
                  date: h.date || item.date,
                  clockInDisplay: h.clockInDisplay || h.clockIn || '—',
                  clockOutDisplay: h.clockOutDisplay || h.clockOut || '—',
                  workedDisplay: h.workedDisplay || h.worked || formatDurationHms(h.netWorkingSeconds || 0),
                  netWorkingSeconds: h.netWorkingSeconds || 0,
                  breakMinutes: h.breakMinutes || 0,
                  totalBreakSeconds: (h.breakMinutes || 0) * 60,
                  breaks: Array.isArray(h.breaks) ? h.breaks : [],
                  status: h.status || 'Completed',
                  state: 'Completed',
                  isActive: false,
                  requiresReview: h.requiresReview === true,
                  isMissedClockout: h.status === 'Missed Clock-Out' || h.requiresReview === true,
                });
              }
            }
          }
        }
      }

      // Finalize live durations and statuses
      const allRecords: any[] = [];
      for (const item of sessionMap.values()) {
        if (item.isActive && (item.state === 'Working' || item.state === 'On break')) {
          const shiftElapsedSeconds = Math.max(0, Math.floor((nowMs - (item.clockInTimestamp || nowMs)) / 1000));
          const currentBreakExtra = item.state === 'On break' && item.currentBreakStart
            ? Math.max(0, Math.floor((nowMs - item.currentBreakStart) / 1000))
            : 0;
          const totalBreakSeconds = (item.totalBreakSeconds || 0) + currentBreakExtra;
          const netWorkingSeconds = Math.max(0, shiftElapsedSeconds - totalBreakSeconds);
          const isStale = shiftElapsedSeconds > 14 * 3600 || (item.date && item.date < todayKarachi);

          allRecords.push({
            ...item,
            shiftElapsedSeconds,
            totalBreakSeconds,
            breakMinutes: Math.floor(totalBreakSeconds / 60),
            netWorkingSeconds,
            workedDisplay: formatDurationHms(netWorkingSeconds),
            requiresReview: isStale || item.requiresReview,
            isMissedClockout: isStale || item.isMissedClockout,
            status: isStale ? 'Missed Clock-Out' : (item.state === 'On break' ? 'On Break' : 'Active Shift'),
          });
        } else {
          allRecords.push({
            ...item,
            workedDisplay: item.workedDisplay || item.worked || formatDurationHms(item.netWorkingSeconds || 0),
            netWorkingSeconds: item.netWorkingSeconds || 0,
            breakMinutes: item.breakMinutes || Math.floor((item.totalBreakSeconds || 0) / 60),
          });
        }
      }

      // Sort newest date & time first
      allRecords.sort((a, b) => {
        const bTime = b.clockInTimestamp || (b.date ? new Date(b.date).getTime() : 0);
        const aTime = a.clockInTimestamp || (a.date ? new Date(a.date).getTime() : 0);
        return bTime - aTime;
      });

      // Filter query parameters
      const { employeeId, department, status, startDate, endDate } = req.query as Record<string, string>;
      let filtered = allRecords;

      if (employeeId && employeeId !== 'All') {
        filtered = filtered.filter((r) =>
          (r.userId && r.userId.toLowerCase().includes(employeeId.toLowerCase())) ||
          (r.employeeName && r.employeeName.toLowerCase().includes(employeeId.toLowerCase())) ||
          (r.employeeEmail && r.employeeEmail.toLowerCase().includes(employeeId.toLowerCase()))
        );
      }

      if (department && department !== 'All') {
        filtered = filtered.filter((r) => (r.department || '').toLowerCase() === department.toLowerCase());
      }

      if (status && status !== 'All') {
        filtered = filtered.filter((r) => {
          if (status === 'Active') return r.state === 'Working' || r.state === 'On break';
          if (status === 'On break') return r.state === 'On break';
          if (status === 'Missed Clock-Out') return r.requiresReview || r.isMissedClockout || r.status === 'Missed Clock-Out';
          if (status === 'Completed') return r.state === 'Completed' || r.state === 'Clocked out';
          return r.status === status || r.state === status;
        });
      }

      if (startDate) {
        filtered = filtered.filter((r) => r.date >= startDate);
      }
      if (endDate) {
        filtered = filtered.filter((r) => r.date <= endDate);
      }

      // Summary metrics computed on authoritative dataset
      const activeStaff = allRecords.filter((r) => r.isActive && (r.state === 'Working' || r.state === 'On break')).length;
      const onBreakToday = allRecords.filter((r) => r.isActive && r.state === 'On break').length;

      // Unique employees who checked in today
      const todayRecords = allRecords.filter((r) => r.date === todayKarachi && r.clockInDisplay && r.clockInDisplay !== '—');
      const uniqueEmployeesToday = new Set(todayRecords.map(r => r.userId || r.employeeEmail || r.employeeName));
      const clockedInToday = uniqueEmployeesToday.size;

      const missedClockouts = allRecords.filter((r) => r.requiresReview || r.isMissedClockout || r.status === 'Missed Clock-Out').length;
      const totalSecsToday = todayRecords.reduce((acc, cur) => acc + (cur.netWorkingSeconds || 0), 0);
      const totalHoursToday = (totalSecsToday / 3600).toFixed(1);

      return res.json({
        success: true,
        records: filtered,
        summary: {
          activeStaff,
          clockedInToday,
          onBreakToday,
          missedClockouts,
          totalHoursToday: parseFloat(totalHoursToday),
        },
      });
    } catch (err: any) {
      console.error('Admin attendance all error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to fetch workforce attendance.' });
    }
  });

  // ----------------------------------------------------
  // API: Admin Resolve Missed Clock-Out
  // ----------------------------------------------------
  app.post('/api/admin/attendance/resolve-missed-clockout', async (req: Request, res: Response) => {
    try {
      const authResult = await verifyAdminCaller(req);
      if (!authResult.authorized || !authResult.idToken) {
        return res.status(403).json({ success: false, error: authResult.error || 'Administrative permissions required.' });
      }

      const { sessionId, correctedClockOutTime, correctedBreakMinutes, reason } = req.body || {};
      if (!sessionId) {
        return res.status(400).json({ success: false, error: 'Session ID is required.' });
      }
      if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
        return res.status(400).json({ success: false, error: 'A valid resolution reason (minimum 5 characters) is required.' });
      }

      // Find record by sessionId
      const targetDoc = await readFirestoreDoc(`attendance/rec_${sessionId}`, authResult.idToken);
      if (!targetDoc) {
        return res.status(404).json({ success: false, error: `Attendance record with ID ${sessionId} not found.` });
      }

      const breakMins = parseInt(correctedBreakMinutes || '0', 10);
      const breakSecs = isNaN(breakMins) ? 0 : breakMins * 60;

      // Recalculate duration if clockInTimestamp is available
      const now = new Date().toISOString();
      const adminEmail = authResult.adminEmail || 'Administrator';

      const originalClockOut = targetDoc.clockOutDisplay || 'Unclosed';
      const finalClockOutDisplay = correctedClockOutTime || '18:00 (Standard)';

      const updatedRecord = {
        ...targetDoc,
        clockOutDisplay: finalClockOutDisplay,
        breakMinutes: breakMins,
        totalBreakSeconds: breakSecs,
        state: 'Completed',
        status: 'Resolved & Verified',
        requiresReview: false,
        isMissedClockout: false,
        correction: {
          originalClockOut,
          correctedClockOut: finalClockOutDisplay,
          correctedBreakMinutes: breakMins,
          reason: reason.trim(),
          resolvedBy: adminEmail,
          resolvedAt: now,
        },
        updatedAt: now,
      };

      await writeFirestoreDoc(`attendance/rec_${sessionId}`, updatedRecord, authResult.idToken);

      // If active session still pointed to this, clear active pointer
      if (targetDoc.userId) {
        await deleteFirestoreDoc(`attendance/active_${targetDoc.userId}`, authResult.idToken);
      }

      // Audit Log
      const auditLogId = `audit_${Date.now()}`;
      await writeFirestoreDoc(`audit_logs/${auditLogId}`, {
        action: 'ATTENDANCE_MISSED_CLOCKOUT_RESOLVED',
        actorEmail: adminEmail,
        actorUid: authResult.adminUid || 'admin',
        targetSessionId: sessionId,
        targetEmployee: targetDoc.employeeName || targetDoc.userId,
        timestamp: now,
        details: `Resolved missed clock-out for session ${sessionId} (${targetDoc.employeeName}). Reason: ${reason}. Clock-out adjusted to: ${finalClockOutDisplay}.`,
      }, authResult.idToken);

      return res.json({
        success: true,
        message: `Missed clock-out for session ${sessionId} resolved successfully.`,
        record: updatedRecord,
      });
    } catch (err: any) {
      console.error('Resolve missed clockout error:', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to resolve missed clock-out.' });
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
