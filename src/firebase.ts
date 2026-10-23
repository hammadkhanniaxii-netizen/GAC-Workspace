import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  getDocFromServer,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
// CRITICAL: Must pass firebaseConfig.firestoreDatabaseId as required by Firebase skill
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errMsg = error instanceof Error ? error.message : String(error);

  if (errMsg.includes('token-service-api-has-not-been-used')) {
    console.warn('Firebase Token Service is not enabled on project; clearing stale auth session.');
    try {
      signOut(auth);
      sessionStorage.removeItem('ga_session_user');
    } catch {}
    return;
  }

  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection() {
  try {
    if (auth.currentUser) {
      try {
        await auth.currentUser.getIdToken(false);
      } catch (tErr: any) {
        if (String(tErr?.message || '').includes('token-service-api-has-not-been-used')) {
          console.warn('Stale auth session with disabled STS API detected; resetting auth state.');
          await signOut(auth);
          try { sessionStorage.removeItem('ga_session_user'); } catch {}
          return;
        }
      }
    }
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error: any) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('token-service-api-has-not-been-used')) {
      console.warn('Notice: Token Service API is disabled on project. Stale session reset.');
      try {
        await signOut(auth);
        sessionStorage.removeItem('ga_session_user');
      } catch {}
    } else if (msg.includes('the client is offline')) {
      console.warn('Firestore offline notice: checking network connection');
    }
  }
}

// Authorized Primary Administrators
export const PRIMARY_SUPER_ADMIN_EMAIL = 'hammad@growthalliance.net';
export const BOOTSTRAP_ADMIN_EMAILS = [
  'hammad@growthalliance.net',
  'hammadkhanniaxii@gmail.com',
];

export type UserRole = 'super_admin' | 'hr_admin' | 'manager' | 'employee';

export interface UserAccountData {
  id?: string;
  email: string;
  name: string;
  employeeId?: string;
  role: UserRole;
  department?: string;
  title?: string;
  status: 'Active' | 'Inactive' | 'Suspended';
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Real Firebase Authentication: authenticates email and password strictly with Firebase Auth.
 * NEVER accepts unverified credentials, never creates mock users, never falls back to demo responses.
 */
export async function loginWithEmail(email: string, pass: string) {
  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail || !pass) {
    throw new Error('Please enter your work email and password.');
  }

  // Real authentication with Firebase Authentication provider
  const res = await signInWithEmailAndPassword(auth, cleanEmail, pass);
  return res.user;
}

/**
 * Verifies that the authenticated user possesses an approved, active account in Firestore,
 * and retrieves their server-authorized role. If the account is missing, inactive,
 * or unapproved, signs out the user immediately and throws an access rejection error.
 */
export async function fetchAndVerifyUserAccount(user: {
  uid: string;
  email: string | null;
}): Promise<UserAccountData> {
  const email = (user.email || '').toLowerCase().trim();

  // 1. Check /admins/{uid}
  let adminRole: UserRole | null = null;
  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    if (adminSnap.exists()) {
      adminRole = (adminSnap.data()?.role as UserRole) || 'super_admin';
    }
  } catch {
    // Non-blocking
  }

  // 2. Check /users/{uid}
  let userSnap = null;
  try {
    userSnap = await getDoc(doc(db, 'users', user.uid));
  } catch {
    // Handled below
  }

  if (userSnap && userSnap.exists()) {
    const data = userSnap.data() as UserAccountData;

    // Check account status - suspended or inactive accounts are rejected
    if (data.status && data.status !== 'Active') {
      await signOut(auth);
      throw new Error(
        `Access Denied: Your account is currently ${data.status.toLowerCase()}. Please contact an administrator.`
      );
    }

    const resolvedRole = (adminRole || data.role || 'employee') as UserRole;
    return {
      id: user.uid,
      email: data.email || email,
      name: data.name || (email ? email.split('@')[0] : 'Member'),
      employeeId: data.employeeId,
      department: data.department || 'Advisory',
      title: data.title || 'Consultant',
      role: resolvedRole,
      status: data.status || 'Active',
    };
  }

  // Primary super admin account verification
  if (email === PRIMARY_SUPER_ADMIN_EMAIL || email === 'hammadkhanniaxii@gmail.com') {
    const bootstrapped: UserAccountData = {
      id: user.uid,
      email,
      name: email === PRIMARY_SUPER_ADMIN_EMAIL ? 'Hammad' : 'System Administrator',
      employeeId: 'GA-EX-001',
      department: 'Executive Governance',
      title: 'Primary Super Administrator',
      role: 'super_admin',
      status: 'Active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'users', user.uid), bootstrapped, { merge: true });
      await setDoc(
        doc(db, 'admins', user.uid),
        {
          email,
          role: 'super_admin',
          grantedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Admin profile initialization notice:', e);
    }

    return bootstrapped;
  }

  // Unapproved / Unknown account: Sign out immediately and deny access
  await signOut(auth);
  throw new Error(
    'Access Denied: Your account has not been approved or provisioned by an administrator.'
  );
}

/**
 * Initiates an official Firebase password reset email.
 */
export async function sendPasswordReset(email: string): Promise<boolean> {
  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Please enter a valid corporate email address.');
  }

  await sendPasswordResetEmail(auth, cleanEmail);
  return true;
}

/**
 * Records an immutable administrative audit log entry
 */
export async function logAuditEvent(action: string, targetEmail: string, details: string) {
  try {
    const actorEmail = auth.currentUser?.email || 'system@growthalliance.net';
    const actorUid = auth.currentUser?.uid || 'system';
    await addDoc(collection(db, 'audit_logs'), {
      action,
      actorEmail,
      actorUid,
      targetEmail,
      details,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('Audit log write error:', e);
  }
}

export async function logoutUser() {
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Sign-out failed', err);
  }
}
