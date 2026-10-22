import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
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
