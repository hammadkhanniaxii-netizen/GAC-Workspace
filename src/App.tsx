// @ts-nocheck
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  db,
  auth,
  testConnection,
  loginWithEmail,
  sendPasswordReset,
  logoutUser,
  fetchAndVerifyUserAccount,
  logAuditEvent,
  handleFirestoreError,
  OperationType,
  PRIMARY_SUPER_ADMIN_EMAIL,
} from './firebase.ts';
import {
  collection,
  doc,
  setDoc,
  onSnapshot,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { AcceptInvitationPage } from './AcceptInvitationPage.tsx';

const b = React;
const x = {
  Fragment: React.Fragment,
  jsxDEV: (type: any, props: any, key?: any) => {
    const { children, key: propKey, ...rest } = props || {};
    const finalKey = key !== undefined && key !== null ? key : propKey;
    const config = finalKey !== undefined && finalKey !== null ? { ...rest, key: finalKey } : rest;
    if (Array.isArray(children)) {
      return React.createElement(type, config, ...children);
    } else if (children !== undefined) {
      return React.createElement(type, config, children);
    }
    return React.createElement(type, config);
  }
};
var S = "App.tsx";

// Safe API client that validates HTTP status and content-type before parsing JSON
async function callApi(url: string, options: RequestInit = {}): Promise<any> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const rawText = await res.text();
    throw new Error(`Server returned non-JSON response (HTTP ${res.status}): ${rawText.slice(0, 120)}`);
  }
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Server responded with HTTP ${res.status}`);
  }
  return data;
}
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isWindows, setIsWindows] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      typeof window !== 'undefined' &&
      (window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true);
    setIsInstalled(isStandalone);

    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent.toLowerCase();
      setIsWindows(/windows|win32|win64/.test(ua));
      setIsIOS(/iphone|ipad|ipod/.test(ua));
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const triggerInstall = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isWindows,
    isIOS,
    triggerInstall,
    deferredPrompt,
  };
}

function PWAInstallModal({ onClose, onInstall, isInstallable }: { onClose: () => void; onInstall: () => void; isInstallable: boolean }) {
  return (0, x.jsxDEV)(O, {
    title: "Install GA Workspace on Windows / Desktop",
    onClose: onClose,
    children: (0, x.jsxDEV)("div", {
      className: "modal-body form-grid",
      children: [
        (0, x.jsxDEV)("div", {
          style: { display: "flex", alignItems: "center", gap: "16px", padding: "14px", background: "var(--soft)", borderRadius: "10px", border: "1px solid var(--line)" },
          children: [
            (0, x.jsxDEV)("div", {
              style: { width: "48px", height: "48px", background: "#0f293c", color: "#fff", borderRadius: "10px", display: "grid", placeItems: "center", fontWeight: "800", fontSize: "16px", flexShrink: 0 },
              children: "GA"
            }, void 0, !1),
            (0, x.jsxDEV)("div", {
              children: [
                (0, x.jsxDEV)("strong", { style: { display: "block", fontSize: "14px", color: "var(--ink)" }, children: "GA Workspace — Growth Alliance Consultancy" }, void 0, !1),
                (0, x.jsxDEV)("span", { style: { fontSize: "11px", color: "var(--muted)" }, children: "Production-ready Progressive Web App with standalone window support" }, void 0, !1)
              ]
            }, void 0, !0)
          ]
        }, void 0, !0),
        (0, x.jsxDEV)("div", {
          style: { fontSize: "12px", lineHeight: "1.6", color: "var(--ink)", padding: "4px 0" },
          children: [
            (0, x.jsxDEV)("p", { style: { margin: "0 0 10px", fontWeight: "600" }, children: "How to install on Windows 10/11 using Google Chrome or Microsoft Edge:" }, void 0, !1),
            (0, x.jsxDEV)("ol", {
              style: { margin: "0 0 14px", paddingLeft: "20px", display: "grid", gap: "6px" },
              children: [
                (0, x.jsxDEV)("li", { children: "Look for the Install button in the address bar on the right (icon with a computer or ⊕)." }, void 0, !1),
                (0, x.jsxDEV)("li", { children: "In Microsoft Edge: click the 'App available' icon or choose Menu (⋯) > Apps > Install GA Workspace." }, void 0, !1),
                (0, x.jsxDEV)("li", { children: "In Google Chrome: click the 'Install GA Workspace' icon in the URL bar or Menu (⋮) > Save and share > Install GA Workspace." }, void 0, !1),
                (0, x.jsxDEV)("li", { children: "Click 'Install' in the prompt to launch GA Workspace in its dedicated window." }, void 0, !1)
              ]
            }, void 0, !0)
          ]
        }, void 0, !0),
        (0, x.jsxDEV)("div", {
          className: "modal-actions",
          children: [
            (0, x.jsxDEV)(T, { type: "button", onClick: onClose, children: "Dismiss" }, void 0, !1),
            isInstallable && (0, x.jsxDEV)(T, {
              type: "button",
              variant: "primary",
              onClick: () => { onInstall(); onClose(); },
              children: "Launch Browser Install"
            }, void 0, !1)
          ]
        }, void 0, !0)
      ]
    }, void 0, !0)
  }, void 0, !1);
}

// Clean production datasets: Empty arrays by default for genuine database records
const ee = [];
const te = [];
const ne = [];
const re = [];
const ie = [];

function C(e, t) {
  let [n, r] = (0, b.useState)(() => {
    try {
      let n = localStorage.getItem(e);
      return n ? JSON.parse(n) : t;
    } catch {
      return t;
    }
  });
  return (0, b.useEffect)(() => {
    localStorage.setItem(e, JSON.stringify(n));
  }, [e, n]), [n, r];
}

function w({ name: e, size: t = 18 }) {
  let n = {
    lock: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("rect", { x: "3", y: "11", width: "18", height: "11", rx: "2", ry: "2" }, void 0, !1),
        (0, x.jsxDEV)("path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }, void 0, !1)
      ]
    }, void 0, !0),
    eye: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("path", { d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" }, void 0, !1),
        (0, x.jsxDEV)("circle", { cx: "12", cy: "12", r: "3" }, void 0, !1)
      ]
    }, void 0, !0),
    eyeOff: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("path", { d: "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" }, void 0, !1),
        (0, x.jsxDEV)("line", { x1: "1", y1: "1", x2: "23", y2: "23" }, void 0, !1)
      ]
    }, void 0, !0),
    shield: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" }, void 0, !1)
      ]
    }, void 0, !0),
    install: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }, void 0, !1),
        (0, x.jsxDEV)("polyline", { points: "7 10 12 15 17 10" }, void 0, !1),
        (0, x.jsxDEV)("line", { x1: "12", y1: "15", x2: "12", y2: "3" }, void 0, !1)
      ]
    }, void 0, !0),
    windows: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("path", { d: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" }, void 0, !1)
      ]
    }, void 0, !0),
    overview: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("rect", { x: "3", y: "3", width: "7", height: "7", rx: "1" }, void 0, !1),
        (0, x.jsxDEV)("rect", { x: "14", y: "3", width: "7", height: "7", rx: "1" }, void 0, !1),
        (0, x.jsxDEV)("rect", { x: "3", y: "14", width: "7", height: "7", rx: "1" }, void 0, !1),
        (0, x.jsxDEV)("rect", { x: "14", y: "14", width: "7", height: "7", rx: "1" }, void 0, !1)
      ]
    }, void 0, !0),
    attendance: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("path", { d: "M12 2a10 10 0 1 0 10 10" }, void 0, !1),
        (0, x.jsxDEV)("path", { d: "M12 6v6l4 2" }, void 0, !1),
        (0, x.jsxDEV)("path", { d: "M16 3h5v5" }, void 0, !1)
      ]
    }, void 0, !0),
    tasks: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }, void 0, !1),
        (0, x.jsxDEV)("path", { d: "m7 10 2 2 4-4M14 12h3M7 16h10" }, void 0, !1)
      ]
    }, void 0, !0),
    announcements: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("path", { d: "M3 11v2a2 2 0 0 0 2 2h2l3 4h2l-1-4 8-3V6L7 9H5a2 2 0 0 0-2 2Z" }, void 0, !1),
        (0, x.jsxDEV)("path", { d: "M19 8a3 3 0 0 1 0 5" }, void 0, !1)
      ]
    }, void 0, !0),
    leave: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("rect", { x: "3", y: "5", width: "18", height: "16", rx: "2" }, void 0, !1),
        (0, x.jsxDEV)("path", { d: "M16 3v4M8 3v4M3 10h18M9 14l6 4M15 14l-6 4" }, void 0, !1)
      ]
    }, void 0, !0),
    directory: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("circle", { cx: "9", cy: "8", r: "3" }, void 0, !1),
        (0, x.jsxDEV)("circle", { cx: "17", cy: "9", r: "2" }, void 0, !1),
        (0, x.jsxDEV)("path", { d: "M3 20a6 6 0 0 1 12 0M14 15a5 5 0 0 1 7 5" }, void 0, !1)
      ]
    }, void 0, !0),
    reports: (0, x.jsxDEV)(x.Fragment, {
      children: (0, x.jsxDEV)("path", { d: "M4 20V10M10 20V4M16 20v-7M22 20H2" }, void 0, !1)
    }, void 0, !1),
    settings: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("circle", { cx: "12", cy: "12", r: "3" }, void 0, !1),
        (0, x.jsxDEV)("path", { d: "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" }, void 0, !1)
      ]
    }, void 0, !0),
    bell: (0, x.jsxDEV)(x.Fragment, {
      children: (0, x.jsxDEV)("path", { d: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" }, void 0, !1)
    }, void 0, !1),
    search: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("circle", { cx: "11", cy: "11", r: "7" }, void 0, !1),
        (0, x.jsxDEV)("path", { d: "m20 20-4-4" }, void 0, !1)
      ]
    }, void 0, !0),
    plus: (0, x.jsxDEV)("path", { d: "M12 5v14M5 12h14" }, void 0, !1),
    menu: (0, x.jsxDEV)("path", { d: "M4 7h16M4 12h16M4 17h16" }, void 0, !1),
    close: (0, x.jsxDEV)("path", { d: "m6 6 12 12M18 6 6 18" }, void 0, !1),
    check: (0, x.jsxDEV)("path", { d: "m5 12 4 4L19 6" }, void 0, !1),
    arrow: (0, x.jsxDEV)("path", { d: "m9 18 6-6-6-6" }, void 0, !1),
    download: (0, x.jsxDEV)("path", { d: "M12 3v12m0 0 5-5m-5 5-5-5M4 21h16" }, void 0, !1),
    filter: (0, x.jsxDEV)("path", { d: "M4 5h16M7 12h10M10 19h4" }, void 0, !1),
    users: (0, x.jsxDEV)(x.Fragment, {
      children: [
        (0, x.jsxDEV)("circle", { cx: "9", cy: "8", r: "3" }, void 0, !1),
        (0, x.jsxDEV)("path", { d: "M3 20a6 6 0 0 1 12 0M16 4a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5" }, void 0, !1)
      ]
    }, void 0, !0)
  };
  return (0, x.jsxDEV)("svg", {
    "aria-hidden": "true",
    width: t,
    height: t,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    children: n[e] || n.overview
  }, void 0, !1);
}

function T({ children: e, variant: t = "secondary", icon: n, ...r }) {
  return (0, x.jsxDEV)("button", {
    className: `button ${t}`,
    ...r,
    children: [n && (0, x.jsxDEV)(w, { name: n }, void 0, !1), e]
  }, void 0, !0);
}

function E({ children: e, tone: t = "neutral" }) {
  return (0, x.jsxDEV)("span", { className: `badge ${t}`, children: e }, void 0, !1);
}

function D({ title: e, text: t, action: n }) {
  return (0, x.jsxDEV)("div", {
    className: "empty",
    children: [
      (0, x.jsxDEV)("div", { className: "empty-icon", children: (0, x.jsxDEV)(w, { name: "search", size: 24 }, void 0, !1) }, void 0, !1),
      (0, x.jsxDEV)("h3", { children: e }, void 0, !1),
      (0, x.jsxDEV)("p", { children: t }, void 0, !1),
      n
    ]
  }, void 0, !0);
}

function O({ title: e, children: t, onClose: n, wide: r = false }) {
  return (0, b.useEffect)(() => {
    let e = (e: any) => e.key === "Escape" && n();
    return window.addEventListener("keydown", e), () => window.removeEventListener("keydown", e);
  }, [n]), (0, x.jsxDEV)("div", {
    className: "modal-backdrop",
    role: "presentation",
    onMouseDown: (e: any) => e.target === e.currentTarget && n(),
    children: (0, x.jsxDEV)("div", {
      className: `modal ${r ? "wide" : ""}`,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": e,
      children: [
        (0, x.jsxDEV)("div", {
          className: "modal-head",
          children: [
            (0, x.jsxDEV)("div", {
              children: [
                (0, x.jsxDEV)("span", { className: "eyebrow", children: "GA Workspace" }, void 0, !1),
                (0, x.jsxDEV)("h2", { children: e }, void 0, !1)
              ]
            }, void 0, !0),
            (0, x.jsxDEV)(T, { variant: "ghost", "aria-label": "Close dialog", onClick: n, children: (0, x.jsxDEV)(w, { name: "close" }, void 0, !1) }, void 0, !1)
          ]
        }, void 0, !0),
        t
      ]
    }, void 0, !0)
  }, void 0, !1);
}

function ae({ label: e, error: t, children: n }) {
  return (0, x.jsxDEV)("label", {
    className: "field",
    children: [
      (0, x.jsxDEV)("span", { children: e }, void 0, !1),
      n,
      t && (0, x.jsxDEV)("small", { className: "field-error", children: t }, void 0, !1)
    ]
  }, void 0, !0);
}

// Navigation structure
var oe = [
  { route: "overview", label: "Overview", icon: "overview" },
  { route: "attendance", label: "Attendance", icon: "attendance" },
  { route: "tasks", label: "My Tasks", icon: "tasks" },
  { route: "announcements", label: "Announcements", icon: "announcements" },
  { route: "leave", label: "Leave Management", icon: "leave" },
  { route: "directory", label: "Team Directory", icon: "directory" },
  { route: "reports", label: "Reports", icon: "reports" }
];

var se = [
  { route: "admin", label: "Admin Overview", icon: "overview" },
  { route: "accounts", label: "User Management", icon: "shield" },
  { route: "employees", label: "Employee Directory", icon: "users" },
  { route: "task-admin", label: "Task Management", icon: "tasks" },
  { route: "announcement-admin", label: "Announcement Management", icon: "announcements" },
  { route: "leave-admin", label: "Leave Approvals", icon: "leave" },
  { route: "attendance-admin", label: "Attendance Management", icon: "attendance" }
];

// ==========================================
// FORGOT PASSWORD RECOVERY MODAL
// ==========================================
function PasswordResetModal({ onClose, defaultEmail = "" }: { onClose: () => void; defaultEmail?: string }) {
  const [resetEmail, setResetEmail] = (0, b.useState)(defaultEmail);
  const [sending, setSending] = (0, b.useState)(false);
  const [status, setStatus] = (0, b.useState)<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSend = async (e: any) => {
    e.preventDefault();
    if (!resetEmail.trim() || !resetEmail.includes("@")) {
      setStatus({ type: 'error', message: 'Please provide a valid work email address.' });
      return;
    }

    setSending(true);
    setStatus(null);
    try {
      await sendPasswordReset(resetEmail.trim());
      setStatus({
        type: 'success',
        message: `If an approved account exists for ${resetEmail.trim()}, password reset instructions have been sent. Please check your inbox.`
      });
      await logAuditEvent('PASSWORD_RESET_DISPATCHED', resetEmail.trim(), 'User requested reset');
    } catch (err: any) {
      if (err.code === "auth/user-not-found") {
        // Non-disclosing message for security
        setStatus({
          type: 'success',
          message: `If an approved account exists for ${resetEmail.trim()}, password reset instructions have been sent. Please check your inbox.`
        });
      } else if (err.code === "auth/operation-not-allowed") {
        setStatus({
          type: 'error',
          message: 'Email and password authentication is not enabled on this Firebase project. An administrator must enable Email/Password provider in the Firebase Console.'
        });
      } else {
        setStatus({
          type: 'error',
          message: err.message || 'Unable to process password reset request.'
        });
      }
    } finally {
      setSending(false);
    }
  };

  return (0, x.jsxDEV)(O, {
    title: "Forgot Password",
    onClose,
    children: (0, x.jsxDEV)("form", {
      onSubmit: handleSend,
      children: [
        (0, x.jsxDEV)("div", {
          className: "modal-body form-grid",
          children: [
            (0, x.jsxDEV)("p", {
              style: { fontSize: "12px", color: "var(--muted)", margin: 0 },
              children: "Enter your registered Growth Alliance corporate email address to receive a secure password recovery link."
            }, void 0, !1),
            status && (0, x.jsxDEV)("div", {
              className: status.type === 'success' ? "toast" : "form-alert",
              style: status.type === 'success' ? { position: "static", width: "100%", maxWidth: "100%", margin: "8px 0" } : { margin: "8px 0" },
              children: status.message
            }, void 0, !1),
            (0, x.jsxDEV)(ae, {
              label: "Corporate Email Address",
              children: (0, x.jsxDEV)("input", {
                type: "email",
                required: true,
                value: resetEmail,
                onChange: (e: any) => setResetEmail(e.target.value),
                placeholder: "name@growthalliance.net",
                disabled: sending
              }, void 0, !1)
            }, void 0, !1)
          ]
        }, void 0, !0),
        (0, x.jsxDEV)("div", {
          className: "modal-actions",
          children: [
            (0, x.jsxDEV)(T, { type: "button", onClick: onClose, children: "Close" }, void 0, !1),
            (0, x.jsxDEV)(T, {
              type: "submit",
              variant: "primary",
              disabled: sending,
              children: sending ? "Sending..." : "Send Reset Link"
            }, void 0, !1)
          ]
        }, void 0, !0)
      ]
    }, void 0, !0)
  }, void 0, !1);
}

// ==========================================
// SEPARATE EMPLOYEE & ADMINISTRATOR LOGIN UI
// ==========================================

function EmployeeLoginPage({ onLoginSuccess, onSwitchToAdmin }: { onLoginSuccess: (user: any) => void; onSwitchToAdmin: () => void }) {
  const [email, setEmail] = (0, b.useState)("");
  const [password, setPassword] = (0, b.useState)("");
  const [showPassword, setShowPassword] = (0, b.useState)(false);
  const [loading, setLoading] = (0, b.useState)(false);
  const [error, setError] = (0, b.useState)(null);
  const [adminWarning, setAdminWarning] = (0, b.useState)(null);
  const [showForgot, setShowForgot] = (0, b.useState)(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setError(null);
    setAdminWarning(null);

    if (!email.trim() || !password) {
      setError("Please enter your work email and password.");
      return;
    }

    setLoading(true);
    try {
      // 1. Authenticate credentials strictly with Firebase Authentication
      const user = await loginWithEmail(email.trim(), password);

      // 2. Verify approved application account & status from database
      const account = await fetchAndVerifyUserAccount(user);

      // 3. Workspace authorization: Administrators must use admin login
      if (account.role === "super_admin" || account.role === "hr_admin") {
        await logoutUser();
        setAdminWarning({
          email: user.email,
          message: "Administrator Account Detected: Your account possesses Executive Administrator privileges. Please sign in via the Administrator Portal."
        });
        return;
      }

      onLoginSuccess(account);
    } catch (err: any) {
      console.error("Employee login failure:", err);
      if (
        err.code === "auth/invalid-credential" ||
        err.code === "auth/wrong-password" ||
        err.code === "auth/user-not-found"
      ) {
        setError("Invalid email or password. Please verify your credentials.");
      } else if (err.code === "auth/operation-not-allowed") {
        setError("Email and password sign-in is not enabled on this Firebase project. An administrator must enable Email/Password provider in the Firebase Console.");
      } else if (err.code === "auth/too-many-requests") {
        setError("Access to this account has been temporarily disabled due to many failed login attempts. Please try again later.");
      } else {
        setError(err.message || "Authentication failed. Access is restricted to approved Growth Alliance staff.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (0, x.jsxDEV)("div", {
    className: "app-shell",
    style: { display: "grid", placeItems: "center", minHeight: "100vh", background: "var(--canvas)", padding: "20px" },
    children: [
      (0, x.jsxDEV)("div", {
        className: "card",
        style: { maxWidth: "440px", width: "100%", padding: "36px 32px", borderRadius: "16px", boxShadow: "0 20px 40px -15px rgba(15,41,60,0.15)", background: "#ffffff", border: "1px solid var(--line)" },
        children: [
          // Brand Header
          (0, x.jsxDEV)("div", {
            style: { textAlign: "center", marginBottom: "26px" },
            children: [
              (0, x.jsxDEV)("div", {
                style: { width: "52px", height: "52px", background: "linear-gradient(135deg, #0f293c 0%, #173b54 100%)", color: "#ffffff", borderRadius: "14px", display: "grid", placeItems: "center", margin: "0 auto 14px", fontWeight: "800", fontSize: "18px", boxShadow: "0 6px 16px rgba(15,41,60,0.2)" },
                children: "GA"
              }, void 0, !1),
              (0, x.jsxDEV)("h1", { style: { fontSize: "22px", fontWeight: "700", color: "var(--ink)", margin: "0 0 6px" }, children: "Employee Workspace Portal" }, void 0, !1),
              (0, x.jsxDEV)("p", { style: { fontSize: "12px", color: "var(--muted)", margin: 0, lineHeight: "1.5" }, children: "Sign in with your approved employee credentials." }, void 0, !1)
            ]
          }, void 0, !0),

          // Error message
          error && (0, x.jsxDEV)("div", {
            className: "form-alert",
            style: { marginBottom: "18px", display: "flex", gap: "8px", alignItems: "flex-start" },
            children: error
          }, void 0, !1),

          // Admin Warning Redirection Banner
          adminWarning && (0, x.jsxDEV)("div", {
            style: { marginBottom: "20px", padding: "14px", borderRadius: "10px", background: "#eff8ff", border: "1px solid #b2ddff", color: "#175cd3", fontSize: "12px", lineHeight: "1.5" },
            children: [
              (0, x.jsxDEV)("strong", { style: { display: "block", marginBottom: "6px" }, children: "Administrator Account Detected" }, void 0, !1),
              (0, x.jsxDEV)("p", { style: { margin: "0 0 10px" }, children: adminWarning.message }, void 0, !1),
              (0, x.jsxDEV)(T, {
                variant: "primary",
                onClick: onSwitchToAdmin,
                style: { width: "100%", justifyContent: "center" },
                children: "Proceed to Administrator Login →"
              }, void 0, !1)
            ]
          }, void 0, !0),

          // Login Form (Pure Real Auth)
          (0, x.jsxDEV)("form", {
            onSubmit: handleSubmit,
            className: "form-grid",
            children: [
              (0, x.jsxDEV)(ae, {
                label: "Work Email Address",
                children: (0, x.jsxDEV)("input", {
                  type: "email",
                  required: true,
                  value: email,
                  onChange: (e: any) => setEmail(e.target.value),
                  placeholder: "name@growthalliance.net",
                  disabled: loading
                }, void 0, !1)
              }, void 0, !1),

              (0, x.jsxDEV)(ae, {
                label: "Password",
                children: (0, x.jsxDEV)("div", {
                  style: { position: "relative", display: "flex", alignItems: "center" },
                  children: [
                    (0, x.jsxDEV)("input", {
                      type: showPassword ? "text" : "password",
                      required: true,
                      value: password,
                      onChange: (e: any) => setPassword(e.target.value),
                      placeholder: "••••••••",
                      disabled: loading,
                      style: { paddingRight: "40px", width: "100%" }
                    }, void 0, !1),
                    (0, x.jsxDEV)("button", {
                      type: "button",
                      onClick: () => setShowPassword(!showPassword),
                      style: { position: "absolute", right: "10px", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", display: "grid", placeItems: "center", padding: "4px" },
                      children: (0, x.jsxDEV)(w, { name: showPassword ? "eyeOff" : "eye", size: 16 }, void 0, !1)
                    }, void 0, !1)
                  ]
                }, void 0, !0)
              }, void 0, !1),

              (0, x.jsxDEV)("div", {
                style: { display: "flex", justifyContent: "flex-end", marginTop: "-6px" },
                children: (0, x.jsxDEV)("button", {
                  type: "button",
                  onClick: () => setShowForgot(true),
                  style: { background: "none", border: "none", color: "var(--blue)", fontSize: "11px", fontWeight: "600", cursor: "pointer", padding: 0 },
                  children: "Forgot password?"
                }, void 0, !1)
              }, void 0, !1),

              (0, x.jsxDEV)(T, {
                type: "submit",
                variant: "primary",
                disabled: loading,
                style: { width: "100%", justifyContent: "center", marginTop: "8px", height: "42px", fontSize: "13px" },
                children: loading ? "Verifying Credentials..." : "Sign in as Employee"
              }, void 0, !1)
            ]
          }, void 0, !0),

          // Footer Link to Admin Login
          (0, x.jsxDEV)("div", {
            style: { marginTop: "24px", paddingTop: "18px", borderTop: "1px solid var(--line)", textAlign: "center", fontSize: "12px", color: "var(--muted)" },
            children: [
              "Are you a Director or Partner? ",
              (0, x.jsxDEV)("button", {
                type: "button",
                onClick: onSwitchToAdmin,
                style: { background: "none", border: "none", color: "var(--blue)", fontWeight: "600", cursor: "pointer", textDecoration: "underline" },
                children: "Sign in to Admin Portal →"
              }, void 0, !1)
            ]
          }, void 0, !0)
        ]
      }, void 0, !0),

      showForgot && (0, x.jsxDEV)(PasswordResetModal, {
        defaultEmail: email,
        onClose: () => setShowForgot(false)
      }, void 0, !1)
    ]
  }, void 0, !0);
}

function SuperAdminActivationModal({
  onClose,
  onActivationSuccess,
}: {
  onClose: () => void;
  onActivationSuccess: (email: string) => void;
}) {
  const [adminEmail, setAdminEmail] = (0, b.useState)(PRIMARY_SUPER_ADMIN_EMAIL);
  const [bootstrapSecret, setBootstrapSecret] = (0, b.useState)("");
  const [showSecret, setShowSecret] = (0, b.useState)(false);
  const [newPassword, setNewPassword] = (0, b.useState)("");
  const [confirmPassword, setConfirmPassword] = (0, b.useState)("");
  const [showNewPassword, setShowNewPassword] = (0, b.useState)(false);
  const [submitting, setSubmitting] = (0, b.useState)(false);
  const [error, setError] = (0, b.useState)<string | null>(null);
  const [success, setSuccess] = (0, b.useState)<string | null>(null);

  const handleActivate = async (e: any) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanEmail = adminEmail.trim().toLowerCase();
    if (cleanEmail !== PRIMARY_SUPER_ADMIN_EMAIL) {
      setError(`Access Denied: Initial activation is strictly reserved for ${PRIMARY_SUPER_ADMIN_EMAIL}.`);
      return;
    }

    if (!bootstrapSecret.trim()) {
      setError("Please enter the deployment Administrative Bootstrap Secret Key.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setError("Password must contain at least one uppercase letter (A-Z).");
      return;
    }
    if (!/[a-z]/.test(newPassword)) {
      setError("Password must contain at least one lowercase letter (a-z).");
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setError("Password must contain at least one number (0-9).");
      return;
    }
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword)) {
      setError("Password must contain at least one special symbol (!@#$%^&*...).");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/bootstrap-activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
          bootstrapSecret: bootstrapSecret.trim(),
          newPassword,
          confirmPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Activation failed");
      }

      setSuccess("Super Administrator account activated successfully! Redirecting to login...");
      setTimeout(() => {
        onActivationSuccess(cleanEmail);
      }, 1800);
    } catch (err: any) {
      setError(err.message || "Failed to activate Super Admin account");
    } finally {
      setSubmitting(false);
    }
  };

  return (0, x.jsxDEV)(O, {
    title: "First-Time Super Administrator Activation",
    onClose,
    children: (0, x.jsxDEV)("form", {
      onSubmit: handleActivate,
      children: [
        (0, x.jsxDEV)("div", {
          className: "modal-body form-grid",
          children: [
            (0, x.jsxDEV)("div", {
              style: {
                padding: "12px 14px",
                background: "#f0fdf4",
                borderRadius: "10px",
                border: "1px solid #bbf7d0",
                fontSize: "12px",
                color: "#166534",
                lineHeight: "1.5",
              },
              children: [
                (0, x.jsxDEV)("strong", { style: { display: "block", marginBottom: "4px" }, children: "Restricted Executive Bootstrap" }, void 0, !1),
                "This procedure provisions the primary executive account (",
                (0, x.jsxDEV)("code", { style: { background: "#dcfce7", padding: "1px 5px", borderRadius: "4px", fontWeight: "700" }, children: PRIMARY_SUPER_ADMIN_EMAIL }, void 0, !1),
                ") in Firebase Authentication and grants permanent Super Administrator permissions. Once claimed, this bootstrap flow is permanently disabled in Firestore."
              ],
            }, void 0, !0),

            error && (0, x.jsxDEV)("div", { className: "form-alert", style: { margin: "4px 0" }, children: error }, void 0, !1),
            success && (0, x.jsxDEV)("div", { className: "toast", style: { position: "static", width: "100%", maxWidth: "100%", margin: "4px 0", background: "#16a34a" }, children: success }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Designated Super Admin Email",
              children: (0, x.jsxDEV)("input", {
                type: "email",
                required: true,
                value: adminEmail,
                onChange: (e: any) => setAdminEmail(e.target.value),
                placeholder: PRIMARY_SUPER_ADMIN_EMAIL,
                disabled: submitting || !!success,
              }, void 0, !1),
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Administrative Bootstrap Secret Key",
              children: (0, x.jsxDEV)("div", {
                style: { position: "relative", display: "flex", alignItems: "center" },
                children: [
                  (0, x.jsxDEV)("input", {
                    type: showSecret ? "text" : "password",
                    required: true,
                    value: bootstrapSecret,
                    onChange: (e: any) => setBootstrapSecret(e.target.value),
                    placeholder: "Enter deployment bootstrap secret",
                    disabled: submitting || !!success,
                    style: { paddingRight: "40px", width: "100%" },
                  }, void 0, !1),
                  (0, x.jsxDEV)("button", {
                    type: "button",
                    onClick: () => setShowSecret(!showSecret),
                    style: { position: "absolute", right: "10px", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", display: "grid", placeItems: "center", padding: "4px" },
                    children: (0, x.jsxDEV)(w, { name: showSecret ? "eyeOff" : "eye", size: 16 }, void 0, !1),
                  }, void 0, !1),
                ],
              }, void 0, !0),
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "New Permanent Password",
              children: (0, x.jsxDEV)("div", {
                style: { position: "relative", display: "flex", alignItems: "center" },
                children: [
                  (0, x.jsxDEV)("input", {
                    type: showNewPassword ? "text" : "password",
                    required: true,
                    value: newPassword,
                    onChange: (e: any) => setNewPassword(e.target.value),
                    placeholder: "Minimum 8 chars, mixed case, number & symbol",
                    disabled: submitting || !!success,
                    style: { paddingRight: "40px", width: "100%" },
                  }, void 0, !1),
                  (0, x.jsxDEV)("button", {
                    type: "button",
                    onClick: () => setShowNewPassword(!showNewPassword),
                    style: { position: "absolute", right: "10px", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", display: "grid", placeItems: "center", padding: "4px" },
                    children: (0, x.jsxDEV)(w, { name: showNewPassword ? "eyeOff" : "eye", size: 16 }, void 0, !1),
                  }, void 0, !1),
                ],
              }, void 0, !0),
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Confirm Permanent Password",
              children: (0, x.jsxDEV)("input", {
                type: showNewPassword ? "text" : "password",
                required: true,
                value: confirmPassword,
                onChange: (e: any) => setConfirmPassword(e.target.value),
                placeholder: "Re-enter new permanent password",
                disabled: submitting || !!success,
              }, void 0, !1),
            }, void 0, !1),

            (0, x.jsxDEV)("div", {
              style: { fontSize: "11px", color: "var(--muted)", lineHeight: "1.4" },
              children: "Security Policy: Must be at least 8 characters with at least one uppercase letter (A-Z), one lowercase letter (a-z), one digit (0-9), and one symbol (!@#$%...).",
            }, void 0, !1),
          ],
        }, void 0, !0),

        (0, x.jsxDEV)("div", {
          className: "modal-actions",
          children: [
            (0, x.jsxDEV)(T, {
              type: "button",
              onClick: onClose,
              disabled: submitting,
              children: "Cancel",
            }, void 0, !1),
            (0, x.jsxDEV)(T, {
              type: "submit",
              variant: "primary",
              disabled: submitting || !!success,
              style: { background: "#0f293c" },
              children: submitting ? "Activating Super Admin..." : "Activate & Set Password",
            }, void 0, !1),
          ],
        }, void 0, !0),
      ],
    }, void 0, !0),
  }, void 0, !1);
}

function AdminLoginPage({ onLoginSuccess, onSwitchToEmployee }: { onLoginSuccess: (user: any) => void; onSwitchToEmployee: () => void }) {
  const [email, setEmail] = (0, b.useState)("");
  const [password, setPassword] = (0, b.useState)("");
  const [showPassword, setShowPassword] = (0, b.useState)(false);
  const [loading, setLoading] = (0, b.useState)(false);
  const [error, setError] = (0, b.useState)(null);
  const [employeeRejection, setEmployeeRejection] = (0, b.useState)(null);
  const [showForgot, setShowForgot] = (0, b.useState)(false);
  const [bootstrapStatus, setBootstrapStatus] = (0, b.useState)<any>(null);
  const [showActivation, setShowActivation] = (0, b.useState)(false);

  (0, b.useEffect)(() => {
    fetch("/api/admin/bootstrap-status")
      .then((r) => r.json())
      .then((data) => setBootstrapStatus(data))
      .catch((e) => console.warn("Bootstrap status check notice:", e));
  }, []);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setError(null);
    setEmployeeRejection(null);

    if (!email.trim() || !password) {
      setError("Please enter your administrator credentials.");
      return;
    }

    setLoading(true);
    try {
      // 1. Authenticate strictly with Firebase Authentication
      const user = await loginWithEmail(email.trim(), password);

      // 2. Verify account exists in database and is active
      const account = await fetchAndVerifyUserAccount(user);

      // 3. Workspace authorization check
      if (account.role !== "super_admin" && account.role !== "hr_admin") {
        await logoutUser();
        setEmployeeRejection({
          email: user.email,
          message: "Access Denied: The authenticated account is registered as an Employee. Only authorized Executive Administrators and Operations Directors can access governance tools.",
        });
        return;
      }

      onLoginSuccess(account);
    } catch (err: any) {
      console.error("Admin login failure:", err);
      if (
        err.code === "auth/invalid-credential" ||
        err.code === "auth/wrong-password" ||
        err.code === "auth/user-not-found"
      ) {
        setError("Invalid administrator credentials. Access event logged.");
      } else if (err.code === "auth/operation-not-allowed") {
        setError("Email and password sign-in is not enabled on this Firebase project. An administrator must enable Email/Password provider in the Firebase Console.");
      } else if (err.code === "auth/too-many-requests") {
        setError("Access to this account has been temporarily disabled due to many failed login attempts. Please try again later.");
      } else {
        setError(err.message || "Authentication failed. Access is restricted to authorized administrators.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (0, x.jsxDEV)("div", {
    className: "app-shell",
    style: { display: "grid", placeItems: "center", minHeight: "100vh", background: "#0a1926", padding: "20px" },
    children: [
      (0, x.jsxDEV)("div", {
        className: "card",
        style: { maxWidth: "440px", width: "100%", padding: "36px 32px", borderRadius: "16px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)", background: "#ffffff", border: "1px solid #1e3a52" },
        children: [
          // Brand Header (Executive Theme)
          (0, x.jsxDEV)("div", {
            style: { textAlign: "center", marginBottom: "26px" },
            children: [
              (0, x.jsxDEV)("div", {
                style: { width: "52px", height: "52px", background: "#0f293c", color: "#38a149", borderRadius: "14px", display: "grid", placeItems: "center", margin: "0 auto 14px", fontWeight: "800", fontSize: "18px", border: "2px solid #38a149", boxShadow: "0 0 15px rgba(56,161,73,0.3)" },
                children: "GA",
              }, void 0, !1),
              (0, x.jsxDEV)("div", {
                style: { display: "inline-flex", alignItems: "center", gap: "6px", background: "#fef3f2", color: "#b42318", padding: "3px 10px", borderRadius: "12px", fontSize: "10px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" },
                children: [
                  (0, x.jsxDEV)(w, { name: "lock", size: 12 }, void 0, !1),
                  "Restricted Governance",
                ],
              }, void 0, !0),
              (0, x.jsxDEV)("h1", { style: { fontSize: "22px", fontWeight: "700", color: "#0f293c", margin: "4px 0 6px" }, children: "Executive Administration" }, void 0, !1),
              (0, x.jsxDEV)("p", { style: { fontSize: "12px", color: "var(--muted)", margin: 0, lineHeight: "1.5" }, children: "Restricted portal for verified Growth Alliance leadership." }, void 0, !1),
            ],
          }, void 0, !0),

          // First-Time Super Admin Activation Notice Banner
          bootstrapStatus && !bootstrapStatus.isActivated && bootstrapStatus.canActivate && (0, x.jsxDEV)("div", {
            style: {
              marginBottom: "20px",
              padding: "14px 16px",
              background: "#f0fdf4",
              border: "1px solid #86efac",
              borderRadius: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            },
            children: [
              (0, x.jsxDEV)("div", {
                style: { display: "flex", alignItems: "center", gap: "8px" },
                children: [
                  (0, x.jsxDEV)(w, { name: "lock", size: 16 }, void 0, !1),
                  (0, x.jsxDEV)("strong", { style: { fontSize: "12px", color: "#166534" }, children: "First-Time Super Admin Setup" }, void 0, !1),
                ],
              }, void 0, !0),
              (0, x.jsxDEV)("p", {
                style: { margin: 0, fontSize: "11px", color: "#15803d", lineHeight: "1.4" },
                children: "Primary Super Admin account (hammad@growthalliance.net) has not yet been activated. Click below to enter your bootstrap secret and set your permanent password.",
              }, void 0, !1),
              (0, x.jsxDEV)(T, {
                type: "button",
                onClick: () => setShowActivation(true),
                style: { alignSelf: "flex-start", marginTop: "2px", fontSize: "11px", padding: "6px 14px", height: "auto", background: "#166534", color: "#ffffff", border: "none" },
                children: "Activate Super Admin Account →",
              }, void 0, !1),
            ],
          }, void 0, !0),

          // Error message
          error && (0, x.jsxDEV)("div", {
            className: "form-alert",
            style: { marginBottom: "18px" },
            children: error,
          }, void 0, !1),

          // Employee Rejection Notice
          employeeRejection && (0, x.jsxDEV)("div", {
            style: { marginBottom: "20px", padding: "14px", borderRadius: "10px", background: "#fef3f2", border: "1px solid #fecdca", color: "#b42318", fontSize: "12px", lineHeight: "1.5" },
            children: [
              (0, x.jsxDEV)("strong", { style: { display: "block", marginBottom: "6px" }, children: "Access Denied" }, void 0, !1),
              (0, x.jsxDEV)("p", { style: { margin: "0 0 10px" }, children: employeeRejection.message }, void 0, !1),
              (0, x.jsxDEV)(T, {
                variant: "primary",
                onClick: onSwitchToEmployee,
                style: { width: "100%", justifyContent: "center" },
                children: "Return to Employee Portal →",
              }, void 0, !1),
            ],
          }, void 0, !0),

          // Admin Login Form (Pure Real Auth)
          (0, x.jsxDEV)("form", {
            onSubmit: handleSubmit,
            className: "form-grid",
            children: [
              (0, x.jsxDEV)(ae, {
                label: "Administrator Work Email",
                children: (0, x.jsxDEV)("input", {
                  type: "email",
                  required: true,
                  value: email,
                  onChange: (e: any) => setEmail(e.target.value),
                  placeholder: "hammad@growthalliance.net",
                  disabled: loading,
                }, void 0, !1),
              }, void 0, !1),

              (0, x.jsxDEV)(ae, {
                label: "Administrative Key / Password",
                children: (0, x.jsxDEV)("div", {
                  style: { position: "relative", display: "flex", alignItems: "center" },
                  children: [
                    (0, x.jsxDEV)("input", {
                      type: showPassword ? "text" : "password",
                      required: true,
                      value: password,
                      onChange: (e: any) => setPassword(e.target.value),
                      placeholder: "••••••••",
                      disabled: loading,
                      style: { paddingRight: "40px", width: "100%" },
                    }, void 0, !1),
                    (0, x.jsxDEV)("button", {
                      type: "button",
                      onClick: () => setShowPassword(!showPassword),
                      style: { position: "absolute", right: "10px", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", display: "grid", placeItems: "center", padding: "4px" },
                      children: (0, x.jsxDEV)(w, { name: showPassword ? "eyeOff" : "eye", size: 16 }, void 0, !1),
                    }, void 0, !1),
                  ],
                }, void 0, !0),
              }, void 0, !1),

              (0, x.jsxDEV)("div", {
                style: { display: "flex", justifyContent: "flex-end", marginTop: "-6px" },
                children: (0, x.jsxDEV)("button", {
                  type: "button",
                  onClick: () => setShowForgot(true),
                  style: { background: "none", border: "none", color: "var(--blue)", fontSize: "11px", fontWeight: "600", cursor: "pointer", padding: 0 },
                  children: "Forgot password?",
                }, void 0, !1),
              }, void 0, !1),

              (0, x.jsxDEV)(T, {
                type: "submit",
                variant: "primary",
                disabled: loading,
                style: { width: "100%", justifyContent: "center", marginTop: "8px", height: "42px", fontSize: "13px", background: "#0f293c" },
                children: loading ? "Verifying Authorization..." : "Sign in as Administrator",
              }, void 0, !1),
            ],
          }, void 0, !0),

          // Footer Link to Employee Portal
          (0, x.jsxDEV)("div", {
            style: { marginTop: "24px", paddingTop: "18px", borderTop: "1px solid var(--line)", textAlign: "center", fontSize: "12px", color: "var(--muted)" },
            children: [
              "Looking for standard employee tools? ",
              (0, x.jsxDEV)("button", {
                type: "button",
                onClick: onSwitchToEmployee,
                style: { background: "none", border: "none", color: "var(--blue)", fontWeight: "600", cursor: "pointer", textDecoration: "underline" },
                children: "Go to Employee Portal →",
              }, void 0, !1),
            ],
          }, void 0, !0),
        ],
      }, void 0, !0),

      showForgot && (0, x.jsxDEV)(PasswordResetModal, {
        defaultEmail: email || PRIMARY_SUPER_ADMIN_EMAIL,
        onClose: () => setShowForgot(false),
      }, void 0, !1),

      showActivation && (0, x.jsxDEV)(SuperAdminActivationModal, {
        onClose: () => setShowActivation(false),
        onActivationSuccess: (activatedEmail: string) => {
          setEmail(activatedEmail);
          setShowActivation(false);
          setBootstrapStatus({ isActivated: true, canActivate: false });
        },
      }, void 0, !1),
    ],
  }, void 0, !0);
}

// ==========================================
// USER & ACCOUNT MANAGEMENT COMPONENT (ADMIN)
// ==========================================

function AccountManagementView({
  employees,
  setEmployees,
  notify,
  ask,
  currentUserRole,
}: {
  employees: any[];
  setEmployees: any;
  notify: (msg: string) => void;
  ask: any;
  currentUserRole: string;
}) {
  const [searchTerm, setSearchTerm] = (0, b.useState)("");
  const [roleFilter, setRoleFilter] = (0, b.useState)("All");
  const [statusFilter, setStatusFilter] = (0, b.useState)("All");
  const [showCreateModal, setShowCreateModal] = (0, b.useState)(false);
  const [editingUser, setEditingUser] = (0, b.useState)<any>(null);
  const [resetPasswordUser, setResetPasswordUser] = (0, b.useState)<any>(null);
  const [deleteUser, setDeleteUser] = (0, b.useState)<any>(null);

  // Filtered accounts
  const filteredUsers = employees.filter((user) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      (user.name || "").toLowerCase().includes(term) ||
      (user.email || "").toLowerCase().includes(term) ||
      (user.department || "").toLowerCase().includes(term) ||
      (user.employeeId || "").toLowerCase().includes(term);

    const matchesRole =
      roleFilter === "All" || (user.role || "employee") === roleFilter;

    let matchesStatus = true;
    if (statusFilter === "Active") {
      matchesStatus = user.status === "Active";
    } else if (statusFilter === "Disabled") {
      matchesStatus = user.status === "Disabled" || user.status === "Inactive" || user.status === "Deactivated";
    }

    return matchesSearch && matchesRole && matchesStatus;
  });

  const isSuperAdmin = currentUserRole === "super_admin";

  const handleToggleStatus = async (user: any) => {
    const isTargetSuperAdmin = user.role === "super_admin" || user.email === PRIMARY_SUPER_ADMIN_EMAIL;
    if (isTargetSuperAdmin) {
      notify("Protection: The primary Super Administrator account cannot be disabled.");
      return;
    }

    const currentActive = user.status === "Active";
    const newStatus = currentActive ? "Disabled" : "Active";

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("Administrative session expired. Please sign in again.");

      await callApi("/api/admin/employees/update-status", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          employeeId: user.employeeId || user.id,
          email: user.email,
          uid: user.id,
          status: newStatus,
        }),
      });

      setEmployees((prev: any[]) => prev.map((u) => (u.email === user.email || u.id === user.id ? { ...u, status: newStatus } : u)));
      notify(`Account for ${user.name} is now ${newStatus}.`);
    } catch (err: any) {
      notify(`Failed to update status: ${err.message}`);
    }
  };

  const totalCount = employees.length;
  const adminCount = employees.filter((e) => e.role === "super_admin" || e.role === "hr_admin").length;
  const staffCount = employees.filter((e) => e.role !== "super_admin" && e.role !== "hr_admin").length;
  const disabledCount = employees.filter((e) => e.status === "Disabled" || e.status === "Inactive" || e.status === "Deactivated").length;

  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Administration / Governance",
        title: "User & Account Management",
        text: "Directly create corporate credentials, manage account permissions, and configure security statuses.",
        actions: (0, x.jsxDEV)(T, {
          variant: "primary",
          icon: "plus",
          onClick: () => setShowCreateModal(true),
          children: "Create User Account"
        }, void 0, !1)
      }, void 0, !1),

      // Metric Summary Cards
      (0, x.jsxDEV)("div", {
        className: "metrics",
        children: [
          (0, x.jsxDEV)(k, {
            label: "Total Accounts",
            value: String(totalCount),
            helper: `${employees.filter((e) => e.status === "Active").length} active accounts`,
            icon: "users",
            tone: "green"
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Administrators",
            value: String(adminCount),
            helper: "Executive & HR Governance",
            icon: "shield"
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Staff & Consultants",
            value: String(staffCount),
            helper: "Advisory & Operations",
            icon: "tasks"
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Disabled Accounts",
            value: String(disabledCount),
            helper: "Access restricted",
            icon: "lock",
            tone: disabledCount > 0 ? "neutral" : ""
          }, void 0, !1)
        ]
      }, void 0, !0),

      // Filter Toolbar
      (0, x.jsxDEV)("section", {
        className: "filterbar",
        children: [
          (0, x.jsxDEV)("div", {
            className: "search-field",
            children: [
              (0, x.jsxDEV)(w, { name: "search" }, void 0, !1),
              (0, x.jsxDEV)("input", {
                value: searchTerm,
                onChange: (e: any) => setSearchTerm(e.target.value),
                placeholder: "Search accounts by name, email, employee ID, or department..."
              }, void 0, !1)
            ]
          }, void 0, !0),

          (0, x.jsxDEV)("div", {
            className: "tabs",
            children: ["All", "super_admin", "hr_admin", "manager", "employee"].map((r) => (0, x.jsxDEV)("button", {
              className: roleFilter === r ? "active" : "",
              onClick: () => setRoleFilter(r),
              children: r === "All" ? "All Roles" : r.replace("_", " ").toUpperCase()
            }, r, !1))
          }, void 0, !1),

          (0, x.jsxDEV)("div", {
            className: "tabs",
            children: ["All", "Active", "Disabled"].map((s) => (0, x.jsxDEV)("button", {
              className: statusFilter === s ? "active" : "",
              onClick: () => setStatusFilter(s),
              children: s === "All" ? "All Statuses" : s
            }, s, !1))
          }, void 0, !1)
        ]
      }, void 0, !0),

      // Account Records Table
      (0, x.jsxDEV)("section", {
        className: "card table-card",
        children: [
          (0, x.jsxDEV)("div", {
            className: "table-scroll",
            children: (0, x.jsxDEV)("table", {
              children: [
                (0, x.jsxDEV)("thead", {
                  children: (0, x.jsxDEV)("tr", {
                    children: [
                      (0, x.jsxDEV)("th", { children: "Member & Email" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Employee ID" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Department & Title" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Role" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Status" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Actions" }, void 0, !1)
                    ]
                  }, void 0, !0)
                }, void 0, !1),
                (0, x.jsxDEV)("tbody", {
                  children: filteredUsers.map((u) => {
                    const isTargetSuperAdmin = u.role === "super_admin" || u.email === PRIMARY_SUPER_ADMIN_EMAIL;
                    const canEdit = isSuperAdmin || !isTargetSuperAdmin;
                    const isSelf = auth.currentUser?.email?.toLowerCase() === (u.email || "").toLowerCase();
                    const isActive = u.status === "Active";

                    return (0, x.jsxDEV)("tr", {
                      children: [
                        (0, x.jsxDEV)("td", {
                          children: (0, x.jsxDEV)("div", {
                            className: "table-person",
                            children: [
                              (0, x.jsxDEV)("div", {
                                className: "avatar",
                                style: isTargetSuperAdmin ? { background: "#0f293c", color: "#38a149" } : {},
                                children: (u.name || "U").split(" ").map((w: string) => w[0]).join("").slice(0, 2)
                              }, void 0, !1),
                              (0, x.jsxDEV)("div", {
                                children: [
                                  (0, x.jsxDEV)("strong", { children: u.name }, void 0, !1),
                                  (0, x.jsxDEV)("small", { children: u.email }, void 0, !1)
                                ]
                              }, void 0, !0)
                            ]
                          }, void 0, !0)
                        }, void 0, !1),
                        (0, x.jsxDEV)("td", { children: u.employeeId || "—" }, void 0, !1),
                        (0, x.jsxDEV)("td", {
                          children: [
                            (0, x.jsxDEV)("strong", { children: u.department || "Advisory" }, void 0, !1),
                            (0, x.jsxDEV)("small", { children: u.title || "Consultant" }, void 0, !1)
                          ]
                        }, void 0, !0),
                        (0, x.jsxDEV)("td", {
                          children: (0, x.jsxDEV)(E, {
                            tone: u.role === "super_admin" ? "danger" : u.role === "hr_admin" ? "info" : u.role === "manager" ? "warning" : "neutral",
                            children: (u.role || "employee").replace("_", " ").toUpperCase()
                          }, void 0, !1)
                        }, void 0, !1),
                        (0, x.jsxDEV)("td", {
                          children: (0, x.jsxDEV)(E, {
                            tone: isActive ? "success" : "neutral",
                            children: isActive ? "Active" : "Disabled"
                          }, void 0, !1)
                        }, void 0, !1),
                        (0, x.jsxDEV)("td", {
                          children: (0, x.jsxDEV)("div", {
                            className: "inline-actions",
                            children: [
                              canEdit && (0, x.jsxDEV)(T, {
                                variant: "ghost",
                                onClick: () => setEditingUser(u),
                                style: { fontSize: "11px", padding: "4px 8px" },
                                children: "Edit"
                              }, void 0, !1),
                              canEdit && (0, x.jsxDEV)(T, {
                                variant: "ghost",
                                onClick: () => setResetPasswordUser(u),
                                style: { fontSize: "11px", padding: "4px 8px" },
                                children: "Reset Password"
                              }, void 0, !1),
                              canEdit && !isTargetSuperAdmin && (0, x.jsxDEV)(T, {
                                variant: "ghost",
                                onClick: () => handleToggleStatus(u),
                                style: { fontSize: "11px", padding: "4px 8px", color: isActive ? "var(--danger)" : "var(--green)" },
                                children: isActive ? "Disable" : "Activate"
                              }, void 0, !1),
                              canEdit && !isTargetSuperAdmin && !isSelf && (0, x.jsxDEV)(T, {
                                variant: "ghost",
                                onClick: () => setDeleteUser(u),
                                style: { fontSize: "11px", padding: "4px 8px", color: "var(--danger)" },
                                children: "Delete"
                              }, void 0, !1)
                            ]
                          }, void 0, !0)
                        }, void 0, !1)
                      ]
                    }, u.id || u.email, !0);
                  })
                }, void 0, !1)
              ]
            }, void 0, !0)
          }, void 0, !1),

          filteredUsers.length === 0 && (0, x.jsxDEV)(D, {
            title: "No User Accounts Found",
            text: "No accounts match the current filters. Click 'Create User Account' to establish a real employee or administrator account.",
            action: (0, x.jsxDEV)(T, {
              variant: "primary",
              onClick: () => setShowCreateModal(true),
              children: "Create User Account"
            }, void 0, !1)
          }, void 0, !1)
        ]
      }, void 0, !0),

      // Create Account Modal (Direct creation)
      showCreateModal && (0, x.jsxDEV)(CreateAccountModal, {
        onClose: () => setShowCreateModal(false),
        isSuperAdmin,
        onSuccess: (result: any) => {
          if (result.employee) {
            setEmployees((prev: any[]) => {
              const existingIdx = prev.findIndex((e) => e.email === result.employee.email);
              if (existingIdx >= 0) {
                const copy = [...prev];
                copy[existingIdx] = result.employee;
                return copy;
              }
              return [result.employee, ...prev];
            });
          }
          setShowCreateModal(false);
          notify(`Account established for ${result.employee?.name || "employee"}.`);
        }
      }, void 0, !1),

      // Admin Password Reset Modal
      resetPasswordUser && (0, x.jsxDEV)(AdminResetPasswordModal, {
        user: resetPasswordUser,
        onClose: () => setResetPasswordUser(null),
        onSuccess: () => {
          notify(`Password reset for ${resetPasswordUser.name}. They will be prompted to set a permanent password upon login.`);
          setResetPasswordUser(null);
        }
      }, void 0, !1),

      // Delete Account Modal
      deleteUser && (0, x.jsxDEV)(DeleteAccountModal, {
        user: deleteUser,
        onClose: () => setDeleteUser(null),
        onSuccess: () => {
          setEmployees((prev: any[]) => prev.filter((u) => u.email !== deleteUser.email && u.id !== deleteUser.id));
          notify(`Account for ${deleteUser.name} permanently deprovisioned and deleted.`);
          setDeleteUser(null);
        }
      }, void 0, !1),

      // Edit Account Modal
      editingUser && (0, x.jsxDEV)(EditAccountModal, {
        user: editingUser,
        isSuperAdmin,
        onClose: () => setEditingUser(null),
        onSubmit: async (updated: any) => {
          const cleanUpdate = {
            id: String(updated.id),
            employeeId: String(updated.employeeId || updated.id),
            name: String(updated.name).trim(),
            email: String(updated.email).trim().toLowerCase(),
            department: String(updated.department || "Enterprise Advisory").trim(),
            title: String(updated.title || "Consultant").trim(),
            role: updated.role || "employee",
            status: updated.status || "Active",
            updatedAt: new Date().toISOString()
          };

          setEmployees((prev: any[]) => prev.map((u) => (u.id === updated.id || u.email === updated.email ? { ...u, ...cleanUpdate } : u)));
          if (auth.currentUser) {
            try {
              await setDoc(doc(db, "employees", String(updated.id)), cleanUpdate, { merge: true });
              await setDoc(doc(db, "users", String(updated.id)), cleanUpdate, { merge: true });
              if (updated.role === "super_admin" || updated.role === "hr_admin") {
                await setDoc(doc(db, "admins", String(updated.id)), {
                  email: cleanUpdate.email,
                  role: cleanUpdate.role,
                  updatedAt: new Date().toISOString()
                }, { merge: true });
              }
            } catch (err) {
              console.warn("Account update error:", err);
            }
          }

          await logAuditEvent(
            "ACCOUNT_UPDATED",
            cleanUpdate.email,
            `Updated profile for ${cleanUpdate.name}`
          );
          notify(`Updated account details for ${cleanUpdate.name}`);
          setEditingUser(null);
        }
      }, void 0, !1)
    ]
  }, void 0, !0);
}

function CreateAccountModal({
  onClose,
  onSuccess,
  isSuperAdmin,
}: {
  onClose: () => void;
  onSuccess: (result: any) => void;
  isSuperAdmin: boolean;
}) {
  const [name, setName] = (0, b.useState)("");
  const [email, setEmail] = (0, b.useState)("");
  const [employeeId, setEmployeeId] = (0, b.useState)(`GA-${Math.floor(100 + Math.random() * 900)}`);
  const [department, setDepartment] = (0, b.useState)("Enterprise Advisory");
  const [title, setTitle] = (0, b.useState)("Senior Consultant");
  const [role, setRole] = (0, b.useState)("employee");
  const [password, setPassword] = (0, b.useState)("");
  const [confirmPassword, setConfirmPassword] = (0, b.useState)("");
  const [status, setStatus] = (0, b.useState)("Active");
  const [showPassword, setShowPassword] = (0, b.useState)(false);
  const [error, setError] = (0, b.useState)("");
  const [submitting, setSubmitting] = (0, b.useState)(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setError("");

    if (!name.trim() || name.trim().length < 3) {
      setError("Please provide a valid full legal name (minimum 3 characters).");
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError("Please enter a valid corporate work email address.");
      return;
    }

    if (role === "super_admin" && !isSuperAdmin) {
      setError("Only existing Super Administrators can provision new Super Administrator accounts.");
      return;
    }

    if (password.length < 8) {
      setError("Initial password must be at least 8 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Initial password and password confirmation do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error("Administrative session expired. Please sign in again.");
      }

      const data = await callApi("/api/admin/employees/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          email: cleanEmail,
          employeeId: employeeId.trim(),
          department: department.trim(),
          title: title.trim(),
          role,
          password,
          confirmPassword,
          status,
        }),
      });

      onSuccess(data);
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred during account creation.");
    } finally {
      setSubmitting(false);
    }
  };

  return (0, x.jsxDEV)(O, {
    title: "Create User Account",
    onClose,
    children: (0, x.jsxDEV)("form", {
      onSubmit: handleSubmit,
      children: [
        (0, x.jsxDEV)("div", {
          className: "modal-body form-grid",
          children: [
            error && (0, x.jsxDEV)("div", { className: "form-alert", children: error }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Full Name",
              children: (0, x.jsxDEV)("input", {
                required: true,
                value: name,
                onChange: (e: any) => setName(e.target.value),
                placeholder: "Full legal name"
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Corporate Work Email",
              children: (0, x.jsxDEV)("input", {
                type: "email",
                required: true,
                value: email,
                onChange: (e: any) => setEmail(e.target.value),
                placeholder: "colleague@growthalliance.net"
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Employee ID / Badge Number",
              children: (0, x.jsxDEV)("input", {
                required: true,
                value: employeeId,
                onChange: (e: any) => setEmployeeId(e.target.value),
                placeholder: "GA-102"
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Department / Practice",
              children: (0, x.jsxDEV)("select", {
                value: department,
                onChange: (e: any) => setDepartment(e.target.value),
                children: [
                  (0, x.jsxDEV)("option", { children: "Enterprise Advisory" }, void 0, !1),
                  (0, x.jsxDEV)("option", { children: "Strategy & Risk" }, void 0, !1),
                  (0, x.jsxDEV)("option", { children: "Financial Operations" }, void 0, !1),
                  (0, x.jsxDEV)("option", { children: "HR & People" }, void 0, !1),
                  (0, x.jsxDEV)("option", { children: "Executive Governance" }, void 0, !1)
                ]
              }, void 0, !0)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Designation / Job Title",
              children: (0, x.jsxDEV)("input", {
                required: true,
                value: title,
                onChange: (e: any) => setTitle(e.target.value),
                placeholder: "e.g. Senior Consultant / Managing Director"
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Role & Permission Level",
              children: (0, x.jsxDEV)("select", {
                value: role,
                onChange: (e: any) => setRole(e.target.value),
                children: [
                  (0, x.jsxDEV)("option", { value: "employee", children: "Employee (Standard Workspace)" }, void 0, !1),
                  (0, x.jsxDEV)("option", { value: "manager", children: "Manager (Team & Task Management)" }, void 0, !1),
                  (0, x.jsxDEV)("option", { value: "hr_admin", children: "HR Admin (People, Approvals, Notices)" }, void 0, !1),
                  isSuperAdmin && (0, x.jsxDEV)("option", { value: "super_admin", children: "Super Admin (Full Governance & User Management)" }, void 0, !1)
                ]
              }, void 0, !0)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Initial Account Status",
              children: (0, x.jsxDEV)("select", {
                value: status,
                onChange: (e: any) => setStatus(e.target.value),
                children: [
                  (0, x.jsxDEV)("option", { value: "Active", children: "Active (Permit Login)" }, void 0, !1),
                  (0, x.jsxDEV)("option", { value: "Disabled", children: "Disabled (Restrict Login)" }, void 0, !1)
                ]
              }, void 0, !0)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Initial Temporary Password",
              children: (0, x.jsxDEV)("input", {
                type: showPassword ? "text" : "password",
                required: true,
                value: password,
                onChange: (e: any) => setPassword(e.target.value),
                placeholder: "Minimum 8 characters"
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Confirm Initial Password",
              children: (0, x.jsxDEV)("input", {
                type: showPassword ? "text" : "password",
                required: true,
                value: confirmPassword,
                onChange: (e: any) => setConfirmPassword(e.target.value),
                placeholder: "Re-enter initial password"
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)("label", {
              style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--ink)", cursor: "pointer", marginTop: "2px" },
              children: [
                (0, x.jsxDEV)("input", {
                  type: "checkbox",
                  checked: showPassword,
                  onChange: (e: any) => setShowPassword(e.target.checked),
                  style: { width: "16px", height: "16px", accentColor: "var(--green)" }
                }, void 0, !1),
                "Show password characters"
              ]
            }, void 0, !0)
          ]
        }, void 0, !0),

        (0, x.jsxDEV)("div", {
          className: "modal-actions",
          children: [
            (0, x.jsxDEV)(T, { type: "button", onClick: onClose, disabled: submitting, children: "Cancel" }, void 0, !1),
            (0, x.jsxDEV)(T, {
              type: "submit",
              variant: "primary",
              disabled: submitting,
              children: submitting ? "Creating Account..." : "Create Account"
            }, void 0, !1)
          ]
        }, void 0, !0)
      ]
    }, void 0, !0)
  }, void 0, !1);
}

function AdminResetPasswordModal({
  user,
  onClose,
  onSuccess,
}: {
  user: any;
  onClose: () => void;
  onSuccess: (message?: string) => void;
}) {
  const [error, setError] = (0, b.useState)("");
  const [submitting, setSubmitting] = (0, b.useState)(false);

  const handleReset = async (e: any) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("Administrative session expired. Please sign in again.");

      const res = await callApi("/api/admin/employees/reset-password", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          email: user.email,
          employeeId: user.employeeId || user.id,
          uid: user.id,
        }),
      });
      onSuccess(res.message);
    } catch (err: any) {
      setError(err.message || "Failed to reset password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (0, x.jsxDEV)(O, {
    title: `Reset Password · ${user.name}`,
    onClose,
    children: (0, x.jsxDEV)("form", {
      onSubmit: handleReset,
      children: [
        (0, x.jsxDEV)("div", {
          className: "modal-body form-grid",
          children: [
            (0, x.jsxDEV)("div", {
              style: { backgroundColor: "#f0f5ff", border: "1px solid #adc6ff", borderRadius: "8px", padding: "14px", color: "#1d39c4", fontSize: "12px", lineHeight: "1.5" },
              children: [
                (0, x.jsxDEV)("strong", { style: { display: "block", marginBottom: "4px" }, children: `Administrative Password Reset for ${user.name} (${user.email})` }, void 0, !1),
                (0, x.jsxDEV)("div", { children: "This procedure dispatches a secure password recovery message to the employee's work email and flags their account to establish permanent credentials upon login." }, void 0, !1)
              ]
            }, void 0, !0),

            error && (0, x.jsxDEV)("div", { className: "form-alert", children: error }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Corporate Email Address",
              children: (0, x.jsxDEV)("input", {
                type: "email",
                disabled: true,
                value: user.email,
                style: { background: "var(--soft)" }
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Employee ID",
              children: (0, x.jsxDEV)("input", {
                type: "text",
                disabled: true,
                value: user.employeeId || user.id || "—",
                style: { background: "var(--soft)" }
              }, void 0, !1)
            }, void 0, !1)
          ]
        }, void 0, !0),

        (0, x.jsxDEV)("div", {
          className: "modal-actions",
          children: [
            (0, x.jsxDEV)(T, { type: "button", onClick: onClose, disabled: submitting, children: "Cancel" }, void 0, !1),
            (0, x.jsxDEV)(T, {
              type: "submit",
              variant: "primary",
              disabled: submitting,
              children: submitting ? "Dispatching Reset..." : "Send Password Reset"
            }, void 0, !1)
          ]
        }, void 0, !0)
      ]
    }, void 0, !0)
  }, void 0, !1);
}

function DeleteAccountModal({
  user,
  onClose,
  onSuccess,
}: {
  user: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = (0, b.useState)(false);
  const [error, setError] = (0, b.useState)("");

  const handleDelete = async () => {
    setSubmitting(true);
    setError("");
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("Administrative session expired. Please sign in again.");

      await callApi("/api/admin/employees/delete", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          email: user.email,
          employeeId: user.employeeId || user.id,
          uid: user.id,
        }),
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to delete account.");
      setSubmitting(false);
    }
  };

  return (0, x.jsxDEV)(O, {
    title: `Deprovision Account · ${user.name}`,
    onClose,
    children: (0, x.jsxDEV)("div", {
      className: "modal-body form-grid",
      children: [
        (0, x.jsxDEV)("div", {
          style: { backgroundColor: "#fff1f0", border: "1px solid #ffa39e", borderRadius: "8px", padding: "14px", color: "#cf1322", fontSize: "12px", lineHeight: "1.5" },
          children: [
            (0, x.jsxDEV)("strong", { style: { display: "block", marginBottom: "6px", fontSize: "13px" }, children: `Permanently Deprovision ${user.name}?` }, void 0, !1),
            (0, x.jsxDEV)("p", { style: { margin: "0 0 6px" }, children: `You are about to delete the corporate account for ${user.name} (${user.email}).` }, void 0, !1),
            (0, x.jsxDEV)("p", { style: { margin: "0", color: "#820014" }, children: "This action immediately deprovisions their authentication credentials and removes their user record. All business records, tasks, leave approvals, and audit trails remain preserved." }, void 0, !1)
          ]
        }, void 0, !0),

        error && (0, x.jsxDEV)("div", { className: "form-alert", children: error }, void 0, !1),

        (0, x.jsxDEV)("div", {
          className: "modal-actions",
          children: [
            (0, x.jsxDEV)(T, { type: "button", onClick: onClose, disabled: submitting, children: "Cancel" }, void 0, !1),
            (0, x.jsxDEV)(T, {
              type: "button",
              onClick: handleDelete,
              disabled: submitting,
              style: { backgroundColor: "var(--danger)", color: "#fff", borderColor: "var(--danger)" },
              children: submitting ? "Deprovisioning..." : "Permanently Delete Account"
            }, void 0, !1)
          ]
        }, void 0, !0)
      ]
    }, void 0, !0)
  }, void 0, !1);
}

function EditAccountModal({
  user,
  onClose,
  onSubmit,
  isSuperAdmin,
}: {
  user: any;
  onClose: () => void;
  onSubmit: (updated: any) => void;
  isSuperAdmin: boolean;
}) {
  const [name, setName] = (0, b.useState)(user.name || "");
  const [department, setDepartment] = (0, b.useState)(user.department || "Enterprise Advisory");
  const [title, setTitle] = (0, b.useState)(user.title || "Consultant");
  const [role, setRole] = (0, b.useState)(user.role || "employee");
  const [status, setStatus] = (0, b.useState)(user.status || "Active");

  const handleSubmit = (e: any) => {
    e.preventDefault();
    onSubmit({
      ...user,
      name: name.trim(),
      department: department.trim(),
      title: title.trim(),
      role,
      status,
      updatedAt: new Date().toISOString()
    });
  };

  return (0, x.jsxDEV)(O, {
    title: `Edit Account · ${user.name}`,
    onClose,
    children: (0, x.jsxDEV)("form", {
      onSubmit: handleSubmit,
      children: [
        (0, x.jsxDEV)("div", {
          className: "modal-body form-grid",
          children: [
            (0, x.jsxDEV)(ae, {
              label: "Work Email (Fixed)",
              children: (0, x.jsxDEV)("input", {
                type: "email",
                disabled: true,
                value: user.email,
                style: { background: "var(--soft)" }
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Full Name",
              children: (0, x.jsxDEV)("input", {
                required: true,
                value: name,
                onChange: (e: any) => setName(e.target.value)
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Department / Practice",
              children: (0, x.jsxDEV)("input", {
                required: true,
                value: department,
                onChange: (e: any) => setDepartment(e.target.value)
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Job Title",
              children: (0, x.jsxDEV)("input", {
                required: true,
                value: title,
                onChange: (e: any) => setTitle(e.target.value)
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Role Permission",
              children: (0, x.jsxDEV)("select", {
                value: role,
                onChange: (e: any) => setRole(e.target.value),
                disabled: user.email === PRIMARY_SUPER_ADMIN_EMAIL && !isSuperAdmin,
                children: [
                  (0, x.jsxDEV)("option", { value: "employee", children: "Employee" }, void 0, !1),
                  (0, x.jsxDEV)("option", { value: "manager", children: "Manager" }, void 0, !1),
                  (0, x.jsxDEV)("option", { value: "hr_admin", children: "HR Admin" }, void 0, !1),
                  isSuperAdmin && (0, x.jsxDEV)("option", { value: "super_admin", children: "Super Admin" }, void 0, !1)
                ]
              }, void 0, !0)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Status",
              children: (0, x.jsxDEV)("select", {
                value: status,
                onChange: (e: any) => setStatus(e.target.value),
                disabled: user.email === PRIMARY_SUPER_ADMIN_EMAIL,
                children: [
                  (0, x.jsxDEV)("option", { value: "Active", children: "Active" }, void 0, !1),
                  (0, x.jsxDEV)("option", { value: "Disabled", children: "Disabled" }, void 0, !1)
                ]
              }, void 0, !0)
            }, void 0, !1)
          ]
        }, void 0, !0),

        (0, x.jsxDEV)("div", {
          className: "modal-actions",
          children: [
            (0, x.jsxDEV)(T, { type: "button", onClick: onClose, children: "Cancel" }, void 0, !1),
            (0, x.jsxDEV)(T, { type: "submit", variant: "primary", children: "Save Changes" }, void 0, !1)
          ]
        }, void 0, !0)
      ]
    }, void 0, !0)
  }, void 0, !1);
}

function FirstLoginPasswordModal({
  user,
  onSuccess,
}: {
  user: any;
  onSuccess: () => void;
}) {
  const [newPassword, setNewPassword] = (0, b.useState)("");
  const [confirmPassword, setConfirmPassword] = (0, b.useState)("");
  const [showPassword, setShowPassword] = (0, b.useState)(false);
  const [error, setError] = (0, b.useState)("");
  const [submitting, setSubmitting] = (0, b.useState)(false);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("Permanent password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error("Authentication session expired. Please sign in again.");

      await callApi("/api/auth/change-initial-password", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ newPassword, confirmPassword }),
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || "Failed to update permanent password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (0, x.jsxDEV)(O, {
    title: "First Sign-In · Set Permanent Password",
    onClose: () => {},
    children: (0, x.jsxDEV)("form", {
      onSubmit: handleSubmit,
      children: [
        (0, x.jsxDEV)("div", {
          className: "modal-body form-grid",
          children: [
            (0, x.jsxDEV)("div", {
              style: { backgroundColor: "#e6f7ec", border: "1px solid #b7eb8f", borderRadius: "8px", padding: "12px", color: "#135200", fontSize: "12px", lineHeight: "1.5" },
              children: [
                (0, x.jsxDEV)("strong", { style: { display: "block", marginBottom: "4px" }, children: `Welcome to GA Workspace, ${user?.name || "Colleague"}!` }, void 0, !1),
                (0, x.jsxDEV)("div", { children: "Your account was provisioned with a temporary administrator password. To protect your corporate access and confidentiality, please set your private permanent password before entering the workspace." }, void 0, !1)
              ]
            }, void 0, !0),

            error && (0, x.jsxDEV)("div", { className: "form-alert", children: error }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "New Permanent Password",
              children: (0, x.jsxDEV)("input", {
                type: showPassword ? "text" : "password",
                required: true,
                value: newPassword,
                onChange: (e: any) => setNewPassword(e.target.value),
                placeholder: "Minimum 8 chars with uppercase, lowercase, number, symbol"
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Confirm Permanent Password",
              children: (0, x.jsxDEV)("input", {
                type: showPassword ? "text" : "password",
                required: true,
                value: confirmPassword,
                onChange: (e: any) => setConfirmPassword(e.target.value),
                placeholder: "Re-enter new password"
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)("label", {
              style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--ink)", cursor: "pointer" },
              children: [
                (0, x.jsxDEV)("input", {
                  type: "checkbox",
                  checked: showPassword,
                  onChange: (e: any) => setShowPassword(e.target.checked),
                  style: { width: "16px", height: "16px", accentColor: "var(--green)" }
                }, void 0, !1),
                "Show password characters"
              ]
            }, void 0, !0)
          ]
        }, void 0, !0),

        (0, x.jsxDEV)("div", {
          className: "modal-actions",
          children: (0, x.jsxDEV)(T, {
            type: "submit",
            variant: "primary",
            disabled: submitting,
            children: submitting ? "Saving Permanent Password..." : "Establish Permanent Password"
          }, void 0, !1)
        }, void 0, !1)
      ]
    }, void 0, !0)
  }, void 0, !1);
}

// ==========================================
// ROOT APPLICATION COMPONENT
// ==========================================

function ce() {
  let [showInstallGuide, setShowInstallGuide] = (0, b.useState)(false);
  const pwaState = usePWAInstall();

  // Authentication & Trusted Role State
  const [authChecked, setAuthChecked] = (0, b.useState)(false);
  const [authenticatedUser, setAuthenticatedUser] = (0, b.useState)(() => {
    try {
      const saved = sessionStorage.getItem("ga_session_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Current Route detection from URL pathname or initial default
  const getInitialPath = () => {
    if (typeof window !== "undefined") {
      const p = window.location.pathname;
      if (p === "/admin-login" || p === "/employee-login" || p === "/accept-invitation") return p;
    }
    return "/employee-login";
  };
  const [activePath, setActivePath] = (0, b.useState)(getInitialPath);

  // Derive role strictly from verified authenticated user
  const activeRole = authenticatedUser?.role || "employee";
  const [n, r] = (0, b.useState)(
    authenticatedUser?.role === "super_admin" || authenticatedUser?.role === "hr_admin"
      ? "admin"
      : "overview"
  );
  const [i, a] = (0, b.useState)(!1);
  const [o, s] = (0, b.useState)(null);
  const [c, l] = (0, b.useState)(null);
  const [u, d] = (0, b.useState)(null);
  const [f, p] = (0, b.useState)("");
  const [m, h] = (0, b.useState)(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [g, _] = (0, b.useState)(true);

  // Real data collections initialized cleanly
  const [v, y] = C("ga-tasks", ee);
  const [E_leaves, D_leaves] = C("ga-leaves", te);
  const [ae_employees, ce_setEmployees] = C("ga-employees", ne);
  const [ue_announcements, k_announcements] = C("ga-announcements", re);
  const [de_notices, fe_notices] = C("ga-notices", ie);
  const [pe_attendance, me_attendance] = C("ga-attendance", {
    state: "Clocked out",
    clockedIn: "—",
    worked: "00h 00m",
    breakMinutes: 0
  });

  // Sync URL navigation history
  const navigateTo = (pathOrRoute: string) => {
    a(false);
    if (pathOrRoute === "/employee-login" || pathOrRoute === "/admin-login" || pathOrRoute === "/accept-invitation") {
      setActivePath(pathOrRoute);
      if (typeof window !== "undefined") window.history.pushState({}, "", pathOrRoute);
      return;
    }

    // Direct URL Access Guard: Deny non-admin access to admin routes
    const isAdminRole = activeRole === "super_admin" || activeRole === "hr_admin";
    if (
      !isAdminRole &&
      (pathOrRoute === "admin" ||
        pathOrRoute === "accounts" ||
        pathOrRoute === "employees" ||
        pathOrRoute === "task-admin" ||
        pathOrRoute === "announcement-admin" ||
        pathOrRoute === "leave-admin" ||
        pathOrRoute === "attendance-admin")
    ) {
      l("Access Denied: Employee accounts cannot access administrative governance tools.");
      r("overview");
      if (typeof window !== "undefined") window.history.pushState({}, "", "/overview");
      return;
    }

    r(pathOrRoute);
    if (typeof window !== "undefined") {
      const fullUrl = pathOrRoute === "overview" ? "/" : "/" + pathOrRoute;
      window.history.pushState({}, "", fullUrl);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch (e) {
      console.warn("Logout error:", e);
    }
    setAuthenticatedUser(null);
    try { sessionStorage.removeItem("ga_session_user"); } catch {}
    setActivePath("/employee-login");
    if (typeof window !== "undefined") window.history.pushState({}, "", "/employee-login");
    l("Signed out successfully.");
  };

  (0, b.useEffect)(() => {
    testConnection();

    // Browser back/forward navigation support
    const handlePopState = () => {
      const p = window.location.pathname;
      if (p === "/admin-login" || p === "/employee-login" || p === "/accept-invitation") {
        setActivePath(p);
      } else {
        const clean = p.replace(/^\//, "") || "overview";
        const isAdminRole = activeRole === "super_admin" || activeRole === "hr_admin";
        if (
          !isAdminRole &&
          (clean === "admin" ||
            clean === "accounts" ||
            clean === "employees" ||
            clean === "task-admin" ||
            clean === "announcement-admin" ||
            clean === "leave-admin" ||
            clean === "attendance-admin")
        ) {
          r("overview");
        } else {
          r(clean);
        }
      }
    };
    window.addEventListener("popstate", handlePopState);

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (u) {
        try {
          // Preemptively verify token can be retrieved without unhandled STS error
          try {
            await u.getIdToken();
          } catch (tErr: any) {
            if (String(tErr?.message || '').includes('token-service-api-has-not-been-used')) {
              console.warn("Stale session detected with disabled token service API; resetting to clean login.");
              await logoutUser();
              setAuthenticatedUser(null);
              try { sessionStorage.removeItem("ga_session_user"); } catch {}
              setAuthChecked(true);
              return;
            }
          }

          const account = await fetchAndVerifyUserAccount(u);
          setAuthenticatedUser(account);
          try { sessionStorage.setItem("ga_session_user", JSON.stringify(account)); } catch {}

          if (window.location.pathname === "/admin-login" || window.location.pathname === "/employee-login") {
            const isAdminRole = account.role === "super_admin" || account.role === "hr_admin";
            r(isAdminRole ? "admin" : "overview");
          }
        } catch (err: any) {
          console.warn("Unapproved or expired user session rejected:", err.message);
          setAuthenticatedUser(null);
          try { sessionStorage.removeItem("ga_session_user"); } catch {}
          await logoutUser();
        }
      } else {
        setAuthenticatedUser(null);
        try { sessionStorage.removeItem("ga_session_user"); } catch {}
      }
      setAuthChecked(true);
    });

    return () => {
      window.removeEventListener("popstate", handlePopState);
      unsubAuth();
    };
  }, []);

  // Real-time synchronization: attached strictly when user is authenticated
  (0, b.useEffect)(() => {
    if (!authenticatedUser) {
      return;
    }

    let unsubTasks = () => {};
    let unsubLeaves = () => {};
    let unsubAnnouncements = () => {};
    let unsubEmployees = () => {};

    try {
      unsubTasks = onSnapshot(collection(db, "tasks"), (snap) => {
        if (!snap.empty) {
          const list = snap.docs.map(d => ({ ...d.data(), id: d.data().id || d.id }));
          y(list);
        }
      }, (err) => handleFirestoreError(err, OperationType.LIST, "tasks"));

      unsubLeaves = onSnapshot(collection(db, "leaves"), (snap) => {
        if (!snap.empty) {
          const list = snap.docs.map(d => ({ ...d.data(), id: d.data().id || d.id }));
          D_leaves(list);
        }
      }, (err) => handleFirestoreError(err, OperationType.LIST, "leaves"));

      unsubAnnouncements = onSnapshot(collection(db, "announcements"), (snap) => {
        if (!snap.empty) {
          const list = snap.docs.map(d => ({ ...d.data(), id: d.data().id || d.id }));
          k_announcements(list);
        }
      }, (err) => handleFirestoreError(err, OperationType.LIST, "announcements"));

      unsubEmployees = onSnapshot(collection(db, "employees"), (snap) => {
        const list = snap.docs.map(d => ({ ...d.data(), id: d.data().id || d.id }));
        ce_setEmployees(list);
      }, (err) => handleFirestoreError(err, OperationType.LIST, "employees"));
    } catch (e) {
      console.warn("Firestore listeners error:", e);
    }

    return () => {
      unsubTasks();
      unsubLeaves();
      unsubAnnouncements();
      unsubEmployees();
    };
  }, [authenticatedUser]);

  (0, b.useEffect)(() => {
    let e = window.setTimeout(() => _(!1), 400);
    let t = () => h(!0);
    let n = () => h(!1);
    window.addEventListener("online", t);
    window.addEventListener("offline", n);
    return () => {
      clearTimeout(e);
      window.removeEventListener("online", t);
      window.removeEventListener("offline", n);
    };
  }, []);

  (0, b.useEffect)(() => {
    if (!c) return;
    let e = window.setTimeout(() => l(null), 3500);
    return () => clearTimeout(e);
  }, [c]);

  let he = (e: string) => {
    fe_notices((t: any[]) => [{ id: Date.now(), text: e, read: !1, time: "Now" }, ...t]);
    l(e);
  };
  let ge = (e: string) => navigateTo(e);
  let ve_unread = de_notices.filter((e: any) => !e.read).length;
  const isAdminRole = activeRole === "super_admin" || activeRole === "hr_admin";
  let ye_nav = isAdminRole ? [...se, ...oe] : oe;

  // Render dedicated login or invitation acceptance screen if unauthenticated
  if (!authenticatedUser) {
    if (activePath === "/accept-invitation" || (typeof window !== "undefined" && window.location.pathname === "/accept-invitation")) {
      return (0, x.jsxDEV)(AcceptInvitationPage, {
        onAccepted: () => navigateTo("/employee-login"),
        onNavigateToLogin: () => navigateTo("/employee-login")
      }, void 0, !1);
    }

    if (activePath === "/admin-login" || (typeof window !== "undefined" && window.location.pathname === "/admin-login")) {
      return (0, x.jsxDEV)(AdminLoginPage, {
        onLoginSuccess: (account) => {
          setAuthenticatedUser(account);
          try { sessionStorage.setItem("ga_session_user", JSON.stringify(account)); } catch {}
          r("admin");
          if (typeof window !== "undefined") window.history.pushState({}, "", "/admin");
          l("Welcome to Administrator Governance Portal, " + account.name);
        },
        onSwitchToEmployee: () => navigateTo("/employee-login")
      }, void 0, !1);
    }

    return (0, x.jsxDEV)(EmployeeLoginPage, {
      onLoginSuccess: (account) => {
        setAuthenticatedUser(account);
        try { sessionStorage.setItem("ga_session_user", JSON.stringify(account)); } catch {}
        r("overview");
        if (typeof window !== "undefined") window.history.pushState({}, "", "/overview");
        l("Welcome to GA Workspace, " + account.name);
      },
      onSwitchToAdmin: () => navigateTo("/admin-login")
    }, void 0, !1);
  }

  return (0, x.jsxDEV)("div", {
    className: "app-shell",
    children: [
      !m && (0, x.jsxDEV)("div", {
        className: "offline",
        role: "status",
        children: "You are offline. Changes remain on this device and will sync when connection resumes."
      }, void 0, !1),

      (0, x.jsxDEV)("aside", {
        className: `sidebar ${i ? "open" : ""}`,
        children: [
          (0, x.jsxDEV)("div", {
            className: "brand",
            children: [
              (0, x.jsxDEV)("div", { className: "brand-mark", children: "GA" }, void 0, !1),
              (0, x.jsxDEV)("div", {
                children: [
                  (0, x.jsxDEV)("strong", { children: "GA Workspace" }, void 0, !1),
                  (0, x.jsxDEV)("span", { children: "Growth Alliance" }, void 0, !1)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)(T, {
                variant: "ghost",
                className: "mobile-close",
                "aria-label": "Close navigation",
                onClick: () => a(false),
                children: (0, x.jsxDEV)(w, { name: "close" }, void 0, !1)
              }, void 0, !1)
            ]
          }, void 0, !0),

          (0, x.jsxDEV)("nav", {
            "aria-label": "Workspace navigation",
            children: [
              (0, x.jsxDEV)("span", {
                className: "nav-label",
                children: isAdminRole ? "Executive Administration" : "Employee Workspace"
              }, void 0, !1),
              ye_nav.map((item, idx) => (0, x.jsxDEV)("button", {
                className: `nav-item ${n === item.route ? "active" : ""}`,
                onClick: () => ge(item.route),
                children: [
                  (0, x.jsxDEV)(w, { name: item.icon }, void 0, !1),
                  (0, x.jsxDEV)("span", { children: item.label }, void 0, !1),
                  item.route === "tasks" && (0, x.jsxDEV)("b", {
                    children: v.filter(e => e.status !== "Completed").length
                  }, void 0, !1),
                  item.route === "leave-admin" && (0, x.jsxDEV)("b", {
                    children: E_leaves.filter(e => e.status === "Pending").length
                  }, void 0, !1)
                ]
              }, `${item.route}-${idx}`, !0))
            ]
          }, void 0, !0),

          (0, x.jsxDEV)("div", {
            className: "profile",
            children: [
              (0, x.jsxDEV)("div", {
                className: "avatar",
                style: isAdminRole ? { background: "#173b54", color: "#38a149" } : {},
                children: (authenticatedUser?.name || "Member").split(" ").map(w => w[0]).join("").slice(0, 2)
              }, void 0, !1),
              (0, x.jsxDEV)("div", {
                children: [
                  (0, x.jsxDEV)("strong", { children: authenticatedUser?.name || "Member" }, void 0, !1),
                  (0, x.jsxDEV)("span", {
                    children: activeRole === "super_admin"
                      ? "Super Administrator"
                      : activeRole === "hr_admin"
                      ? "HR Operations Admin"
                      : activeRole === "manager"
                      ? "Practice Manager"
                      : "Consultant · Employee"
                  }, void 0, !1)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)(T, {
                variant: "ghost",
                "aria-label": "Settings",
                onClick: () => ge("settings"),
                children: (0, x.jsxDEV)(w, { name: "settings" }, void 0, !1)
              }, void 0, !1)
            ]
          }, void 0, !0)
        ]
      }, void 0, !0),

      i && (0, x.jsxDEV)("div", { className: "sidebar-scrim", onClick: () => a(false) }, void 0, !1),

      (0, x.jsxDEV)("div", {
        className: "main",
        children: [
          (0, x.jsxDEV)("header", {
            className: "topbar",
            children: [
              (0, x.jsxDEV)(T, {
                variant: "ghost",
                className: "menu-button",
                "aria-label": "Open navigation",
                onClick: () => a(true),
                children: (0, x.jsxDEV)(w, { name: "menu" }, void 0, !1)
              }, void 0, !1),

              (0, x.jsxDEV)("div", {
                className: "top-context",
                children: [
                  (0, x.jsxDEV)("span", { children: "Growth Alliance" }, void 0, !1),
                  (0, x.jsxDEV)("strong", {
                    children: isAdminRole ? "Executive Administration" : "Employee Workspace"
                  }, void 0, !1)
                ]
              }, void 0, !0),

              (0, x.jsxDEV)("div", {
                className: "global-search",
                children: [
                  (0, x.jsxDEV)(w, { name: "search" }, void 0, !1),
                  (0, x.jsxDEV)("input", {
                    value: f,
                    onChange: (e: any) => p(e.target.value),
                    onKeyDown: (e: any) => e.key === "Enter" && f.trim() && l(`Searching workspace for “${f.trim()}”`),
                    placeholder: "Search workspace, members, tasks...",
                    "aria-label": "Search workspace"
                  }, void 0, !1)
                ]
              }, void 0, !0),

              (0, x.jsxDEV)("div", {
                className: "online-dot",
                children: [
                  (0, x.jsxDEV)("i", { className: m ? "" : "away" }, void 0, !1),
                  (0, x.jsxDEV)("span", { children: m ? "Online" : "Offline" }, void 0, !1)
                ]
              }, void 0, !0),

              (0, x.jsxDEV)("span", {
                className: "top-date",
                children: new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
              }, void 0, !1),

              !pwaState.isInstalled && (0, x.jsxDEV)(T, {
                variant: "secondary",
                icon: "install",
                onClick: () => {
                  if (pwaState.isInstallable) {
                    pwaState.triggerInstall();
                  } else {
                    setShowInstallGuide(true);
                  }
                },
                style: { fontSize: "11px", padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: "6px", marginLeft: "auto", marginRight: "4px" },
                children: "Install App"
              }, void 0, !1),

              (0, x.jsxDEV)(T, {
                variant: "ghost",
                className: "notice-button",
                "aria-label": `${ve_unread} unread notifications`,
                onClick: () => ge("notifications"),
                children: [
                  (0, x.jsxDEV)(w, { name: "bell" }, void 0, !1),
                  ve_unread > 0 && (0, x.jsxDEV)("b", { children: ve_unread }, void 0, !1)
                ]
              }, void 0, !0),

              (0, x.jsxDEV)(T, {
                variant: "ghost",
                onClick: handleLogout,
                style: { fontSize: "11px", padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: "6px", color: "var(--muted)" },
                children: "Sign Out"
              }, void 0, !1),

              (0, x.jsxDEV)("span", {
                className: `badge ${isAdminRole ? "danger" : "success"}`,
                children: activeRole === "super_admin" ? "Super Admin" : activeRole === "hr_admin" ? "HR Admin" : activeRole === "manager" ? "Manager" : "Employee"
              }, void 0, !1),

              (0, x.jsxDEV)("button", {
                className: "avatar top-avatar",
                style: { cursor: "default" },
                "aria-label": "Authenticated Account",
                children: (authenticatedUser?.name || "GA").split(" ").map(w => w[0]).join("").slice(0, 2)
              }, void 0, !1)
            ]
          }, void 0, !0),

          (0, x.jsxDEV)("main", {
            className: "content",
            children: g ? (0, x.jsxDEV)(Oe, {}, void 0, !1) : (0, x.jsxDEV)(le, {
              route: n,
              role: activeRole,
              currentUser: authenticatedUser,
              tasks: v,
              setTasks: y,
              leaves: E_leaves,
              setLeaves: D_leaves,
              employees: ae_employees,
              setEmployees: ce_setEmployees,
              announcements: ue_announcements,
              notices: de_notices,
              setNotices: fe_notices,
              attendance: pe_attendance,
              setAttendance: me_attendance,
              open: s,
              notify: he,
              ask: d,
              navigate: ge,
              pwa: pwaState,
              showInstallGuide: () => setShowInstallGuide(true)
            }, void 0, !1)
          }, void 0, !1)
        ]
      }, void 0, !0),

      // Modals
      o === "leave" && (0, x.jsxDEV)(j, {
        userName: authenticatedUser?.name || "Consultant",
        onClose: () => s(null),
        onSubmit: (e: any) => {
          D_leaves((t: any[]) => [e, ...t]);
          he(`Leave request ${e.id} submitted for review`);
          s(null);
          if (auth.currentUser) {
            try {
              setDoc(doc(db, "leaves", String(e.id)), { ...e, createdAt: new Date().toISOString() });
            } catch (err) {
              console.warn("Leave write error:", err);
            }
          }
        }
      }, void 0, !1),

      o === "task" && (0, x.jsxDEV)(Te, {
        employees: ae_employees,
        onClose: () => s(null),
        onSubmit: (e: any) => {
          y((t: any[]) => [e, ...t]);
          he(`Task assigned to ${e.assignee}`);
          s(null);
          if (auth.currentUser) {
            try {
              setDoc(doc(db, "tasks", String(e.id)), { ...e, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
            } catch (err) {
              console.warn("Task write error:", err);
            }
          }
        }
      }, void 0, !1),

      o === "employee" && (0, x.jsxDEV)(Ee, {
        onClose: () => s(null),
        onSubmit: (e: any) => {
          ce_setEmployees((t: any[]) => [e, ...t]);
          he(`${e.name} added to the employee directory`);
          s(null);
          if (auth.currentUser) {
            try {
              setDoc(doc(db, "employees", String(e.id)), { ...e });
            } catch (err) {
              console.warn("Employee write error:", err);
            }
          }
        }
      }, void 0, !1),

      o === "announcement" && (0, x.jsxDEV)(De, {
        onClose: () => s(null),
        onSubmit: (e: any) => {
          k_announcements((t: any[]) => [e, ...t]);
          he(`Announcement “${e.title}” published`);
          s(null);
          if (auth.currentUser) {
            try {
              setDoc(doc(db, "announcements", String(e.id)), { ...e, createdAt: new Date().toISOString() });
            } catch (err) {
              console.warn("Announcement write error:", err);
            }
          }
        }
      }, void 0, !1),

      u && (0, x.jsxDEV)(O, {
        title: "Confirm action",
        onClose: () => d(null),
        children: [
          (0, x.jsxDEV)("div", {
            className: "modal-body",
            children: (0, x.jsxDEV)("p", { children: u.text }, void 0, !1)
          }, void 0, !1),
          (0, x.jsxDEV)("div", {
            className: "modal-actions",
            children: [
              (0, x.jsxDEV)(T, { onClick: () => d(null), children: "Cancel" }, void 0, !1),
              (0, x.jsxDEV)(T, {
                variant: "danger",
                onClick: () => { u.action(); d(null); },
                children: "Confirm"
              }, void 0, !1)
            ]
          }, void 0, !0)
        ]
      }, void 0, !0),

      showInstallGuide && (0, x.jsxDEV)(PWAInstallModal, {
        onClose: () => setShowInstallGuide(false),
        onInstall: () => pwaState.triggerInstall(),
        isInstallable: pwaState.isInstallable
      }, void 0, !1),

      authenticatedUser?.mustChangePassword && (0, x.jsxDEV)(FirstLoginPasswordModal, {
        user: authenticatedUser,
        onSuccess: () => {
          setAuthenticatedUser((prev: any) => {
            const updated = { ...prev, mustChangePassword: false };
            try { sessionStorage.setItem("ga_session_user", JSON.stringify(updated)); } catch {}
            return updated;
          });
          he("Permanent password established successfully! Welcome to GA Workspace.");
        }
      }, void 0, !1),

      c && (0, x.jsxDEV)("div", {
        className: "toast",
        role: "status",
        children: [
          (0, x.jsxDEV)("span", { children: (0, x.jsxDEV)(w, { name: "check" }, void 0, !1) }, void 0, !1),
          c,
          (0, x.jsxDEV)("button", { onClick: () => l(null), "aria-label": "Dismiss message", children: (0, x.jsxDEV)(w, { name: "close", size: 16 }, void 0, !1) }, void 0, !1)
        ]
      }, void 0, !0)
    ]
  }, void 0, !0);
}

// Router switcher
function le(e: any) {
  switch (e.route) {
    case "attendance":
      return (0, x.jsxDEV)(fe, { ...e }, void 0, !1);
    case "tasks":
      return (0, x.jsxDEV)(pe, { ...e }, void 0, !1);
    case "announcements":
      return (0, x.jsxDEV)(he, { ...e }, void 0, !1);
    case "leave":
      return (0, x.jsxDEV)(me, { ...e }, void 0, !1);
    case "directory":
      return (0, x.jsxDEV)(ge, { ...e }, void 0, !1);
    case "reports":
      return (0, x.jsxDEV)(_e, { ...e }, void 0, !1);
    case "admin":
      return (0, x.jsxDEV)(ve, { ...e }, void 0, !1);
    case "accounts":
      return (0, x.jsxDEV)(AccountManagementView, {
        employees: e.employees,
        setEmployees: e.setEmployees,
        notify: e.notify,
        ask: e.ask,
        currentUserRole: e.role
      }, void 0, !1);
    case "employees":
      return (0, x.jsxDEV)(ye, { ...e }, void 0, !1);
    case "task-admin":
      return (0, x.jsxDEV)(be, { ...e }, void 0, !1);
    case "announcement-admin":
      return (0, x.jsxDEV)(A, { ...e }, void 0, !1);
    case "leave-admin":
      return (0, x.jsxDEV)(xe, { ...e }, void 0, !1);
    case "attendance-admin":
      return (0, x.jsxDEV)(Se, { ...e }, void 0, !1);
    case "settings":
      return (0, x.jsxDEV)(we, { ...e }, void 0, !1);
    case "notifications":
      return (0, x.jsxDEV)(Ce, { ...e }, void 0, !1);
    default:
      return (0, x.jsxDEV)(de, { ...e }, void 0, !1);
  }
}

function ue({ eyebrow: e, title: t, text: n, actions: r }: any) {
  return (0, x.jsxDEV)("div", {
    className: "page-head",
    children: [
      (0, x.jsxDEV)("div", {
        children: [
          (0, x.jsxDEV)("span", { className: "breadcrumb", children: e }, void 0, !1),
          (0, x.jsxDEV)("h1", { children: t }, void 0, !1),
          (0, x.jsxDEV)("p", { children: n }, void 0, !1)
        ]
      }, void 0, !0),
      r && (0, x.jsxDEV)("div", { className: "head-actions", children: r }, void 0, !1)
    ]
  }, void 0, !0);
}

function k({ label: e, value: t, helper: n, icon: r, tone: i = "" }: any) {
  return (0, x.jsxDEV)("div", {
    className: `metric-card ${i}`,
    children: [
      (0, x.jsxDEV)("div", {
        className: "metric-top",
        children: [
          (0, x.jsxDEV)("span", { children: e }, void 0, !1),
          (0, x.jsxDEV)("div", { className: "metric-icon", children: (0, x.jsxDEV)(w, { name: r }, void 0, !1) }, void 0, !1)
        ]
      }, void 0, !0),
      (0, x.jsxDEV)("strong", { children: t }, void 0, !1),
      (0, x.jsxDEV)("p", { children: n }, void 0, !1)
    ]
  }, void 0, !0);
}

// ------------------------------------------
// EMPLOYEE OVERVIEW DASHBOARD
// ------------------------------------------
function de(e: any) {
  let openTasks = e.tasks.filter((t: any) => t.status !== "Completed");
  const userName = e.currentUser?.name || "Consultant";
  const userLeaves = e.leaves.filter((l: any) => l.employee === userName || l.userId === e.currentUser?.id);
  const pendingLeaves = userLeaves.filter((l: any) => l.status === "Pending").length;
  const activeStaff = e.employees.filter((emp: any) => emp.status === "Active").length;

  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Workspace / Overview",
        title: `Good day, ${userName}`,
        text: "Here is your operational consultancy brief and assigned deliverables.",
        actions: (0, x.jsxDEV)(T, {
          variant: "primary",
          icon: "plus",
          onClick: () => e.open("task"),
          children: "Quick task"
        }, void 0, !1)
      }, void 0, !1),

      (0, x.jsxDEV)("div", {
        className: "metrics",
        children: [
          (0, x.jsxDEV)(k, {
            label: "Working time",
            value: e.attendance.worked || "00h 00m",
            helper: `Shift status: ${e.attendance.state}`,
            icon: "attendance",
            tone: e.attendance.state === "Working" ? "green" : ""
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "My Open tasks",
            value: String(openTasks.length),
            helper: `${openTasks.filter((t: any) => (t.due || "").includes("Today")).length} due today`,
            icon: "tasks"
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Leave requests",
            value: String(userLeaves.length),
            helper: `${pendingLeaves} awaiting review`,
            icon: "leave",
            tone: pendingLeaves > 0 ? "amber" : ""
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Active Directory",
            value: String(activeStaff),
            helper: `${activeStaff} registered active staff`,
            icon: "users"
          }, void 0, !1)
        ]
      }, void 0, !0),

      (0, x.jsxDEV)("div", {
        className: "dashboard-grid",
        children: [
          // Tasks Section
          (0, x.jsxDEV)("section", {
            className: "card span-2",
            children: [
              (0, x.jsxDEV)("div", {
                className: "card-head",
                children: [
                  (0, x.jsxDEV)("div", {
                    children: [
                      (0, x.jsxDEV)("span", { className: "eyebrow", children: "Priority work" }, void 0, !1),
                      (0, x.jsxDEV)("h2", { children: "Active deliverables" }, void 0, !1)
                    ]
                  }, void 0, !0),
                  (0, x.jsxDEV)(T, {
                    variant: "ghost",
                    onClick: () => e.navigate("tasks"),
                    children: ["View all ", (0, x.jsxDEV)(w, { name: "arrow" }, void 0, !1)]
                  }, void 0, !0)
                ]
              }, void 0, !0),

              openTasks.length === 0 ? (0, x.jsxDEV)(D, {
                title: "No tasks assigned",
                text: "You have no outstanding assignments. Use 'Quick task' to create one or check in with your practice lead."
              }, void 0, !1) : (
                openTasks.slice(0, 3).map((t: any) => (0, x.jsxDEV)("div", {
                  className: "compact-row",
                  children: [
                    (0, x.jsxDEV)("button", {
                      className: "check-control",
                      "aria-label": `Complete ${t.title}`,
                      onClick: () => e.setTasks((prev: any[]) => prev.map((item: any) => item.id === t.id ? { ...item, status: "Completed", progress: 100 } : item))
                    }, void 0, !1),
                    (0, x.jsxDEV)("div", {
                      children: [
                        (0, x.jsxDEV)("strong", { children: t.title }, void 0, !1),
                        (0, x.jsxDEV)("span", { children: [t.project || "Advisory", " · Due: ", t.due] }, void 0, !0)
                      ]
                    }, void 0, !0),
                    (0, x.jsxDEV)(E, {
                      tone: t.priority === "Urgent" ? "danger" : t.priority === "High" ? "warning" : "neutral",
                      children: t.priority
                    }, void 0, !1)
                  ]
                }, t.id, !0))
              )
            ]
          }, void 0, !0),

          // Announcements Section
          (0, x.jsxDEV)("section", {
            className: "card",
            children: [
              (0, x.jsxDEV)("div", {
                className: "card-head",
                children: (0, x.jsxDEV)("div", {
                  children: [
                    (0, x.jsxDEV)("span", { className: "eyebrow", children: "Latest notice" }, void 0, !1),
                    (0, x.jsxDEV)("h2", { children: "Company update" }, void 0, !1)
                  ]
                }, void 0, !0)
              }, void 0, !1),

              e.announcements.length === 0 ? (
                (0, x.jsxDEV)(D, {
                  title: "No updates published",
                  text: "Official leadership notices and circulars will be displayed here."
                }, void 0, !1)
              ) : (
                (0, x.jsxDEV)("div", {
                  className: "announcement-feature",
                  children: [
                    (0, x.jsxDEV)("div", {
                      className: "feature-icon",
                      children: (0, x.jsxDEV)(w, { name: "announcements" }, void 0, !1)
                    }, void 0, !1),
                    (0, x.jsxDEV)(E, { tone: "info", children: e.announcements[0]?.audience || "All staff" }, void 0, !1),
                    (0, x.jsxDEV)("h3", { children: e.announcements[0]?.title }, void 0, !1),
                    (0, x.jsxDEV)("p", { children: e.announcements[0]?.body }, void 0, !1),
                    (0, x.jsxDEV)(T, {
                      variant: "ghost",
                      onClick: () => e.navigate("announcements"),
                      children: ["Read all announcements ", (0, x.jsxDEV)(w, { name: "arrow" }, void 0, !1)]
                    }, void 0, !0)
                  ]
                }, void 0, !0)
              )
            ]
          }, void 0, !0),

          // Activity Stream Section
          (0, x.jsxDEV)("section", {
            className: "card span-2",
            children: [
              (0, x.jsxDEV)("div", {
                className: "card-head",
                children: (0, x.jsxDEV)("div", {
                  children: [
                    (0, x.jsxDEV)("span", { className: "eyebrow", children: "Recent activity" }, void 0, !1),
                    (0, x.jsxDEV)("h2", { children: "Workspace stream" }, void 0, !1)
                  ]
                }, void 0, !0)
              }, void 0, !1),
              (0, x.jsxDEV)("div", {
                className: "timeline",
                children: [
                  (0, x.jsxDEV)("div", {
                    children: [
                      (0, x.jsxDEV)("i", {}, void 0, !1),
                      (0, x.jsxDEV)("strong", { children: `Session verified · ${e.attendance.state}` }, void 0, !1),
                      (0, x.jsxDEV)("span", { children: "Attendance Engine logged state" }, void 0, !1)
                    ]
                  }, void 0, !0),
                  (0, x.jsxDEV)("div", {
                    children: [
                      (0, x.jsxDEV)("i", {}, void 0, !1),
                      (0, x.jsxDEV)("strong", { children: "Secure RBAC Active" }, void 0, !1),
                      (0, x.jsxDEV)("span", { children: "Growth Alliance Consultancy portal" }, void 0, !1)
                    ]
                  }, void 0, !0)
                ]
              }, void 0, !0)
            ]
          }, void 0, !0),

          // Active Team Members Section
          (0, x.jsxDEV)("section", {
            className: "card team-card",
            children: [
              (0, x.jsxDEV)("div", {
                className: "card-head",
                children: (0, x.jsxDEV)("div", {
                  children: [
                    (0, x.jsxDEV)("span", { className: "eyebrow", children: "Staff" }, void 0, !1),
                    (0, x.jsxDEV)("h2", { children: "Active team" }, void 0, !1)
                  ]
                }, void 0, !0)
              }, void 0, !1),
              e.employees.filter((emp: any) => emp.status === "Active").length === 0 ? (
                (0, x.jsxDEV)(D, {
                  title: "Directory empty",
                  text: "No other active colleagues registered yet."
                }, void 0, !1)
              ) : (
                e.employees.filter((emp: any) => emp.status === "Active").slice(0, 4).map((emp: any) => (0, x.jsxDEV)("div", {
                  className: "person-row",
                  children: [
                    (0, x.jsxDEV)("div", {
                      className: "avatar",
                      children: (emp.name || "U").split(" ").map((w: string) => w[0]).join("").slice(0, 2)
                    }, void 0, !1),
                    (0, x.jsxDEV)("div", {
                      children: [
                        (0, x.jsxDEV)("strong", { children: emp.name }, void 0, !1),
                        (0, x.jsxDEV)("span", { children: emp.title || emp.department || "Consultant" }, void 0, !1)
                      ]
                    }, void 0, !0),
                    (0, x.jsxDEV)("i", {}, void 0, !1)
                  ]
                }, emp.id || emp.email, !0))
              )
            ]
          }, void 0, !0)
        ]
      }, void 0, !0)
    ]
  }, void 0, !0);
}

// ------------------------------------------
// ATTENDANCE LOG VIEW
// ------------------------------------------
function fe(e: any) {
  const attendanceRecords: any[] = [];

  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Workspace / Attendance",
        title: "Attendance & time logs",
        text: "Track your shift check-in, active session hours, and compliance.",
        actions: (0, x.jsxDEV)(x.Fragment, {
          children: [
            (0, x.jsxDEV)(T, {
              icon: "download",
              onClick: () => e.notify("Timesheet export prepared successfully"),
              children: "Export timesheet"
            }, void 0, !1),
            (0, x.jsxDEV)(T, {
              onClick: () => e.notify("Adjustment request submitted to manager"),
              children: "Request adjustment"
            }, void 0, !1)
          ]
        }, void 0, !0)
      }, void 0, !1),

      (0, x.jsxDEV)("div", {
        className: "metrics",
        children: [
          (0, x.jsxDEV)(k, {
            label: "Today's working time",
            value: e.attendance.worked || "00h 00m",
            helper: `First in: ${e.attendance.clockedIn || "—"}`,
            icon: "attendance",
            tone: e.attendance.state === "Working" ? "green" : ""
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Current Status",
            value: e.attendance.state,
            helper: "Verified session",
            icon: "check"
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Break Taken",
            value: `${e.attendance.breakMinutes || 0}m`,
            helper: "Authorized pause",
            icon: "attendance",
            tone: "amber"
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Target shift",
            value: "8.0 hrs",
            helper: "Standard workday schedule",
            icon: "reports"
          }, void 0, !1)
        ]
      }, void 0, !0),

      // Active Work Session Panel
      (0, x.jsxDEV)("section", {
        className: "shift-panel",
        children: [
          (0, x.jsxDEV)("div", {
            children: [
              (0, x.jsxDEV)("span", { className: "eyebrow light", children: "Active work session" }, void 0, !1),
              (0, x.jsxDEV)("h2", { children: e.attendance.state }, void 0, !1),
              (0, x.jsxDEV)("p", { children: `Standard shift · Check-in: ${e.attendance.clockedIn} · Verified` }, void 0, !1)
            ]
          }, void 0, !0),
          (0, x.jsxDEV)("div", {
            className: "shift-actions",
            children: [
              (0, x.jsxDEV)(T, {
                onClick: () => {
                  if (e.attendance.state === "Clocked out") {
                    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    e.setAttendance({ state: "Working", clockedIn: now, worked: "00h 01m", breakMinutes: 0 });
                    e.notify("Clock-in recorded at " + now);
                    return;
                  }
                  let newState = e.attendance.state === "On break" ? "Working" : "On break";
                  e.setAttendance((prev: any) => ({ ...prev, state: newState }));
                  e.notify(newState === "On break" ? "Break session started" : "Work session resumed");
                },
                children: e.attendance.state === "Clocked out"
                  ? "Clock In"
                  : e.attendance.state === "On break"
                  ? "Resume work"
                  : "Take break"
              }, void 0, !1),
              e.attendance.state !== "Clocked out" && (0, x.jsxDEV)(T, {
                variant: "danger",
                onClick: () => e.ask({
                  text: "Clock out now? This will complete your active session.",
                  action: () => {
                    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    e.setAttendance((prev: any) => ({ ...prev, state: "Clocked out" }));
                    e.notify("Clocked out at " + now);
                  }
                }),
                children: "Clock out"
              }, void 0, !1)
            ]
          }, void 0, !0)
        ]
      }, void 0, !0),

      (0, x.jsxDEV)("section", {
        className: "card table-card",
        children: [
          (0, x.jsxDEV)("div", {
            className: "card-head wrap",
            children: (0, x.jsxDEV)("div", {
              children: [
                (0, x.jsxDEV)("span", { className: "eyebrow", children: "Attendance Archive" }, void 0, !1),
                (0, x.jsxDEV)("h2", { children: "Monthly attendance record" }, void 0, !1)
              ]
            }, void 0, !0)
          }, void 0, !1),

          attendanceRecords.length === 0 ? (
            (0, x.jsxDEV)(D, {
              title: "No archived timesheets",
              text: "Historical daily attendance timestamps will automatically appear here as work sessions conclude."
            }, void 0, !1)
          ) : null
        ]
      }, void 0, !0)
    ]
  }, void 0, !0);
}

// ------------------------------------------
// TASKS VIEW
// ------------------------------------------
function pe(e: any) {
  let [filter, setFilter] = (0, b.useState)("All");
  let [selectedId, setSelectedId] = (0, b.useState)(e.tasks[0]?.id);
  let [search, setSearch] = (0, b.useState)("");

  let filtered = e.tasks.filter((t: any) => (filter === "All" || t.status === filter) && (t.title || "").toLowerCase().includes(search.toLowerCase()));
  let activeTask = e.tasks.find((t: any) => t.id === selectedId) || filtered[0];

  const updateStatus = (id: any, newStatus: string) => {
    e.setTasks((prev: any[]) => prev.map((t: any) => t.id === id ? { ...t, status: newStatus, progress: newStatus === "Completed" ? 100 : t.progress } : t));
    e.notify(`Task moved to ${newStatus}`);
  };

  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Workspace / My Tasks",
        title: "My tasks",
        text: "Plan, track, and complete your consultancy deliverables.",
        actions: (0, x.jsxDEV)(T, {
          variant: "primary",
          icon: "plus",
          onClick: () => e.open("task"),
          children: "New task"
        }, void 0, !1)
      }, void 0, !1),

      (0, x.jsxDEV)("section", {
        className: "filterbar",
        children: [
          (0, x.jsxDEV)("div", {
            className: "search-field",
            children: [
              (0, x.jsxDEV)(w, { name: "search" }, void 0, !1),
              (0, x.jsxDEV)("input", {
                value: search,
                onChange: (ev: any) => setSearch(ev.target.value),
                placeholder: "Search tasks by title..."
              }, void 0, !1)
            ]
          }, void 0, !0),
          (0, x.jsxDEV)(T, {
            icon: "filter",
            onClick: () => { setFilter("All"); setSearch(""); },
            children: "Clear filters"
          }, void 0, !1)
        ]
      }, void 0, !0),

      (0, x.jsxDEV)("div", {
        className: "tabs task-tabs",
        children: ["All", "To Do", "In Progress", "In Review", "Completed"].map((s) => (0, x.jsxDEV)("button", {
          className: filter === s ? "active" : "",
          onClick: () => setFilter(s),
          children: [s, " ", (0, x.jsxDEV)("span", {
            children: s === "All" ? e.tasks.length : e.tasks.filter((t: any) => t.status === s).length
          }, void 0, !1)]
        }, s, !0))
      }, void 0, !1),

      (0, x.jsxDEV)("div", {
        className: "task-layout",
        children: [
          (0, x.jsxDEV)("section", {
            className: "task-list",
            children: [
              filtered.map((t: any) => (0, x.jsxDEV)("button", {
                className: `task-card ${activeTask?.id === t.id ? "selected" : ""}`,
                onClick: () => setSelectedId(t.id),
                children: [
                  (0, x.jsxDEV)("span", { className: `priority-line ${(t.priority || "").toLowerCase()}` }, void 0, !1),
                  (0, x.jsxDEV)("div", {
                    className: "task-card-main",
                    children: [
                      (0, x.jsxDEV)("div", {
                        className: "task-title-row",
                        children: [
                          (0, x.jsxDEV)("strong", { children: t.title }, void 0, !1),
                          (0, x.jsxDEV)(E, { tone: t.priority === "Urgent" ? "danger" : "neutral", children: t.priority }, void 0, !1),
                          (0, x.jsxDEV)(E, { tone: t.status === "Completed" ? "success" : "info", children: t.status }, void 0, !1)
                        ]
                      }, void 0, !0),
                      (0, x.jsxDEV)("span", { children: t.project }, void 0, !1),
                      t.progress > 0 && (0, x.jsxDEV)("div", {
                        className: "progress",
                        children: [
                          (0, x.jsxDEV)("i", { style: { width: `${t.progress}%` } }, void 0, !1),
                          (0, x.jsxDEV)("small", { children: [`${t.progress}%`] }, void 0, !0)
                        ]
                      }, void 0, !0),
                      (0, x.jsxDEV)("div", {
                        className: "task-meta",
                        children: [
                          (0, x.jsxDEV)("span", { children: t.due }, void 0, !1),
                          (0, x.jsxDEV)("span", { children: t.assignee }, void 0, !1)
                        ]
                      }, void 0, !0)
                    ]
                  }, void 0, !0)
                ]
              }, t.id, !0)),

              filtered.length === 0 && (0, x.jsxDEV)(D, {
                title: "No tasks found",
                text: "No tasks match your current filter criteria. Click 'New task' to assign one.",
                action: (0, x.jsxDEV)(T, {
                  onClick: () => { setFilter("All"); setSearch(""); },
                  children: "Clear filters"
                }, void 0, !1)
              }, void 0, !1)
            ]
          }, void 0, !0),

          activeTask && (0, x.jsxDEV)("aside", {
            className: "task-detail",
            children: [
              (0, x.jsxDEV)("div", {
                className: "detail-badges",
                children: [
                  (0, x.jsxDEV)(E, { tone: activeTask.priority === "Urgent" ? "danger" : "neutral", children: `${activeTask.priority} priority` }, void 0, !1),
                  (0, x.jsxDEV)(E, { tone: "info", children: activeTask.status }, void 0, !1)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)("h2", { children: activeTask.title }, void 0, !1),
              (0, x.jsxDEV)("span", { style: { fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: "16px" }, children: activeTask.project }, void 0, !1),
              (0, x.jsxDEV)("div", {
                className: "detail-stats",
                children: [
                  (0, x.jsxDEV)("div", {
                    children: [
                      (0, x.jsxDEV)("span", { children: "Assignee" }, void 0, !1),
                      (0, x.jsxDEV)("strong", { children: activeTask.assignee }, void 0, !1)
                    ]
                  }, void 0, !0),
                  (0, x.jsxDEV)("div", {
                    children: [
                      (0, x.jsxDEV)("span", { children: "Due date" }, void 0, !1),
                      (0, x.jsxDEV)("strong", { children: activeTask.due }, void 0, !1)
                    ]
                  }, void 0, !0)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)("div", {
                className: "detail-actions",
                children: (0, x.jsxDEV)(T, {
                  variant: "primary",
                  onClick: () => updateStatus(activeTask.id, activeTask.status === "Completed" ? "In Progress" : "Completed"),
                  children: activeTask.status === "Completed" ? "Reopen task" : "Mark as completed"
                }, void 0, !1)
              }, void 0, !1)
            ]
          }, void 0, !0)
        ]
      }, void 0, !0)
    ]
  }, void 0, !0);
}

// ------------------------------------------
// LEAVE MANAGEMENT VIEW
// ------------------------------------------
function me(e: any) {
  let [filter, setFilter] = (0, b.useState)("All");
  const userName = e.currentUser?.name || "Consultant";
  const userLeaves = e.leaves.filter((l: any) => l.employee === userName || l.userId === e.currentUser?.id);
  const filtered = userLeaves.filter((l: any) => filter === "All" || l.status === filter);

  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Workspace / Leave Management",
        title: "Leave management",
        text: "Submit time-off applications, check entitlement balances, and track approval status.",
        actions: (0, x.jsxDEV)(x.Fragment, {
          children: [
            (0, x.jsxDEV)(T, {
              icon: "download",
              onClick: () => e.notify("Entitlement summary prepared"),
              children: "Entitlement report"
            }, void 0, !1),
            (0, x.jsxDEV)(T, {
              variant: "primary",
              icon: "plus",
              onClick: () => e.open("leave"),
              children: "Apply for leave"
            }, void 0, !1)
          ]
        }, void 0, !0)
      }, void 0, !1),

      (0, x.jsxDEV)("div", {
        className: "metrics leave-metrics",
        children: [
          (0, x.jsxDEV)(k, {
            label: "Pending applications",
            value: String(userLeaves.filter((l: any) => l.status === "Pending").length),
            helper: "Awaiting partner review",
            icon: "tasks",
            tone: "amber"
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Approved this year",
            value: `${userLeaves.filter((l: any) => l.status === "Approved").reduce((acc: number, l: any) => acc + (Number(l.days) || 0), 0)} days`,
            helper: "Recorded time-off",
            icon: "leave",
            tone: "green"
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Total applications",
            value: String(userLeaves.length),
            helper: "Submitted requests",
            icon: "attendance"
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Status",
            value: "Active",
            helper: "Full-time advisory contract",
            icon: "check"
          }, void 0, !1)
        ]
      }, void 0, !0),

      (0, x.jsxDEV)("section", {
        className: "card table-card",
        children: [
          (0, x.jsxDEV)("div", {
            className: "card-head wrap",
            children: [
              (0, x.jsxDEV)("div", {
                children: [
                  (0, x.jsxDEV)("span", { className: "eyebrow", children: "Audit history" }, void 0, !1),
                  (0, x.jsxDEV)("h2", { children: "Leave request history" }, void 0, !1)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)("div", {
                className: "tabs",
                children: ["All", "Pending", "Approved", "Declined"].map((s) => (0, x.jsxDEV)("button", {
                  className: filter === s ? "active" : "",
                  onClick: () => setFilter(s),
                  children: s
                }, s, !1))
              }, void 0, !1)
            ]
          }, void 0, !0),

          filtered.length === 0 ? (
            (0, x.jsxDEV)(D, {
              title: "No leave requests found",
              text: "You haven't submitted any leave requests under this filter category.",
              action: (0, x.jsxDEV)(T, {
                variant: "primary",
                onClick: () => e.open("leave"),
                children: "Apply for leave"
              }, void 0, !1)
            }, void 0, !1)
          ) : (
            (0, x.jsxDEV)("div", {
              className: "table-scroll",
              children: (0, x.jsxDEV)("table", {
                children: [
                  (0, x.jsxDEV)("thead", {
                    children: (0, x.jsxDEV)("tr", {
                      children: [
                        (0, x.jsxDEV)("th", { children: "Request ID" }, void 0, !1),
                        (0, x.jsxDEV)("th", { children: "Leave Type" }, void 0, !1),
                        (0, x.jsxDEV)("th", { children: "Date Range" }, void 0, !1),
                        (0, x.jsxDEV)("th", { children: "Days" }, void 0, !1),
                        (0, x.jsxDEV)("th", { children: "Status" }, void 0, !1),
                        (0, x.jsxDEV)("th", { children: "Actions" }, void 0, !1)
                      ]
                    }, void 0, !0)
                  }, void 0, !1),
                  (0, x.jsxDEV)("tbody", {
                    children: filtered.map((l: any) => (0, x.jsxDEV)("tr", {
                      children: [
                        (0, x.jsxDEV)("td", { children: (0, x.jsxDEV)("strong", { children: l.id }, void 0, !1) }, void 0, !1),
                        (0, x.jsxDEV)("td", { children: [l.type, " leave", (0, x.jsxDEV)("br", {}, void 0, !1), (0, x.jsxDEV)("small", { children: l.reason }, void 0, !1)] }, void 0, !0),
                        (0, x.jsxDEV)("td", { children: `${l.start} – ${l.end}` }, void 0, !1),
                        (0, x.jsxDEV)("td", { children: l.days }, void 0, !1),
                        (0, x.jsxDEV)("td", { children: (0, x.jsxDEV)(E, { tone: l.status === "Approved" ? "success" : l.status === "Pending" ? "warning" : "danger", children: l.status }, void 0, !1) }, void 0, !1),
                        (0, x.jsxDEV)("td", {
                          children: l.status === "Pending" && (0, x.jsxDEV)(T, {
                            variant: "ghost",
                            onClick: () => e.ask({
                              text: `Cancel leave request ${l.id}?`,
                              action: () => {
                                e.setLeaves((prev: any[]) => prev.map((item: any) => item.id === l.id ? { ...item, status: "Cancelled" } : item));
                                e.notify(`Request ${l.id} cancelled`);
                              }
                            }),
                            children: "Cancel"
                          }, void 0, !1)
                        }, void 0, !1)
                      ]
                    }, l.id, !0))
                  }, void 0, !1)
                ]
              }, void 0, !0)
            }, void 0, !1)
          )
        ]
      }, void 0, !0)
    ]
  }, void 0, !0);
}

// ------------------------------------------
// ANNOUNCEMENTS VIEW
// ------------------------------------------
function he(e: any) {
  let [search, setSearch] = (0, b.useState)("");
  let filtered = e.announcements.filter((a: any) => `${a.title} ${a.body}`.toLowerCase().includes(search.toLowerCase()));

  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Workspace / Announcements",
        title: "Company announcements",
        text: "Official leadership communiqués and corporate updates."
      }, void 0, !1),

      (0, x.jsxDEV)("section", {
        className: "filterbar",
        children: (0, x.jsxDEV)("div", {
          className: "search-field",
          children: [
            (0, x.jsxDEV)(w, { name: "search" }, void 0, !1),
            (0, x.jsxDEV)("input", {
              value: search,
              onChange: (ev: any) => setSearch(ev.target.value),
              placeholder: "Search announcements..."
            }, void 0, !1)
          ]
        }, void 0, !0)
      }, void 0, !1),

      filtered.length === 0 ? (
        (0, x.jsxDEV)(D, {
          title: "No announcements published",
          text: "There are currently no company announcements."
        }, void 0, !1)
      ) : (
        (0, x.jsxDEV)("div", {
          className: "announcement-grid",
          children: filtered.map((a: any, idx: number) => (0, x.jsxDEV)("article", {
            className: `announcement-card ${idx === 0 ? "featured" : ""}`,
            children: [
              (0, x.jsxDEV)("div", {
                className: "announcement-meta",
                children: [
                  (0, x.jsxDEV)(E, { tone: idx === 0 ? "success" : "info", children: a.audience || "All employees" }, void 0, !1),
                  (0, x.jsxDEV)("span", { children: a.published || "Recently" }, void 0, !1)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)("h2", { children: a.title }, void 0, !1),
              (0, x.jsxDEV)("p", { children: a.body }, void 0, !1)
            ]
          }, a.id, !0))
        }, void 0, !1)
      )
    ]
  }, void 0, !0);
}

// ------------------------------------------
// TEAM DIRECTORY VIEW
// ------------------------------------------
function ge(e: any) {
  let [search, setSearch] = (0, b.useState)("");
  let filtered = e.employees.filter((emp: any) => `${emp.name} ${emp.department} ${emp.title} ${emp.email}`.toLowerCase().includes(search.toLowerCase()));

  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Workspace / Team Directory",
        title: "Team directory",
        text: `${e.employees.length} colleagues across Growth Alliance Consultancy.`
      }, void 0, !1),

      (0, x.jsxDEV)("section", {
        className: "filterbar",
        children: (0, x.jsxDEV)("div", {
          className: "search-field",
          children: [
            (0, x.jsxDEV)(w, { name: "search" }, void 0, !1),
            (0, x.jsxDEV)("input", {
              value: search,
              onChange: (ev: any) => setSearch(ev.target.value),
              placeholder: "Search colleagues by name, role, department..."
            }, void 0, !1)
          ]
        }, void 0, !0)
      }, void 0, !1),

      filtered.length === 0 ? (
        (0, x.jsxDEV)(D, {
          title: "No colleagues found",
          text: "No team members matched your search criteria."
        }, void 0, !1)
      ) : (
        (0, x.jsxDEV)("div", {
          className: "people-grid",
          children: filtered.map((emp: any) => (0, x.jsxDEV)("article", {
            className: "person-card",
            children: [
              (0, x.jsxDEV)("div", {
                className: "avatar large",
                children: (emp.name || "U").split(" ").map((w: string) => w[0]).join("").slice(0, 2)
              }, void 0, !1),
              (0, x.jsxDEV)("div", {
                children: [
                  (0, x.jsxDEV)("h3", { children: emp.name }, void 0, !1),
                  (0, x.jsxDEV)("p", { children: emp.title }, void 0, !1),
                  (0, x.jsxDEV)("span", { children: emp.department }, void 0, !1)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)(E, {
                tone: emp.status === "Active" ? "success" : "neutral",
                children: emp.status || "Active"
              }, void 0, !1),
              (0, x.jsxDEV)("a", { href: `mailto:${emp.email}`, children: "Email colleague" }, void 0, !1)
            ]
          }, emp.id || emp.email, !0))
        }, void 0, !1)
      )
    ]
  }, void 0, !0);
}

// ------------------------------------------
// REPORTS VIEW
// ------------------------------------------
function _e(e: any) {
  const completed = e.tasks.filter((t: any) => t.status === "Completed").length;
  const totalTasks = Math.max(e.tasks.length, 1);
  const completionRate = Math.round((completed / totalTasks) * 100);

  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Workspace / Reports",
        title: "Operational analytics",
        text: "Summary computed dynamically from live workspace database records.",
        actions: (0, x.jsxDEV)(T, {
          icon: "download",
          onClick: () => e.notify("Personal activity report exported"),
          children: "Export report"
        }, void 0, !1)
      }, void 0, !1),

      (0, x.jsxDEV)("div", {
        className: "metrics",
        children: [
          (0, x.jsxDEV)(k, {
            label: "Task completion",
            value: `${completionRate}%`,
            helper: `${completed} of ${e.tasks.length} tasks completed`,
            icon: "tasks",
            tone: completionRate > 50 ? "green" : ""
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Open tasks",
            value: String(e.tasks.length - completed),
            helper: "Active backlog",
            icon: "tasks"
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Leave requests",
            value: String(e.leaves.length),
            helper: `${e.leaves.filter((l: any) => l.status === "Approved").length} approved`,
            icon: "leave"
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Staff in directory",
            value: String(e.employees.length),
            helper: "Active consulting team",
            icon: "users"
          }, void 0, !1)
        ]
      }, void 0, !0)
    ]
  }, void 0, !0);
}

// ------------------------------------------
// ADMIN OVERVIEW DASHBOARD
// ------------------------------------------
function ve(e: any) {
  const activeWorkforce = e.employees.filter((emp: any) => emp.status === "Active").length;
  const pendingLeaves = e.leaves.filter((l: any) => l.status === "Pending");
  const activeTasks = e.tasks.filter((t: any) => t.status !== "Completed").length;

  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Administration / Operations",
        title: "Executive operations & governance",
        text: "Company-wide workforce health, approvals, deliverables, and role management.",
        actions: (0, x.jsxDEV)(T, {
          variant: "primary",
          icon: "plus",
          onClick: () => e.navigate("accounts"),
          children: "Manage Accounts"
        }, void 0, !1)
      }, void 0, !1),

      (0, x.jsxDEV)("div", {
        className: "quick-actions",
        children: [
          (0, x.jsxDEV)(T, { onClick: () => e.navigate("accounts"), icon: "shield", children: "User Management" }, void 0, !1),
          (0, x.jsxDEV)(T, { onClick: () => e.navigate("leave-admin"), icon: "leave", children: "Review leave requests" }, void 0, !1),
          (0, x.jsxDEV)(T, { onClick: () => e.open("announcement"), icon: "announcements", children: "Publish announcement" }, void 0, !1),
          (0, x.jsxDEV)(T, { onClick: () => e.open("task"), icon: "tasks", children: "Assign urgent task" }, void 0, !1)
        ]
      }, void 0, !0),

      (0, x.jsxDEV)("div", {
        className: "metrics",
        children: [
          (0, x.jsxDEV)(k, {
            label: "Active workforce",
            value: String(activeWorkforce),
            helper: `${e.employees.length} registered accounts`,
            icon: "users",
            tone: "green"
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Pending approvals",
            value: String(pendingLeaves.length),
            helper: "Partner action needed",
            icon: "leave",
            tone: pendingLeaves.length > 0 ? "amber" : ""
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Active deliverables",
            value: String(activeTasks),
            helper: `${e.tasks.length} total tasks logged`,
            icon: "tasks"
          }, void 0, !1),
          (0, x.jsxDEV)(k, {
            label: "Announcements",
            value: String(e.announcements.length),
            helper: "Published notices",
            icon: "announcements"
          }, void 0, !1)
        ]
      }, void 0, !0),

      (0, x.jsxDEV)("div", {
        className: "dashboard-grid",
        children: [
          // Pending Approvals Queue
          (0, x.jsxDEV)("section", {
            className: "card span-2",
            children: [
              (0, x.jsxDEV)("div", {
                className: "card-head",
                children: [
                  (0, x.jsxDEV)("div", {
                    children: [
                      (0, x.jsxDEV)("span", { className: "eyebrow", children: "Approval queue" }, void 0, !1),
                      (0, x.jsxDEV)("h2", { children: "Pending leave applications" }, void 0, !1)
                    ]
                  }, void 0, !0),
                  (0, x.jsxDEV)(T, {
                    variant: "ghost",
                    onClick: () => e.navigate("leave-admin"),
                    children: ["View all ", (0, x.jsxDEV)(w, { name: "arrow" }, void 0, !1)]
                  }, void 0, !0)
                ]
              }, void 0, !0),

              pendingLeaves.length === 0 ? (
                (0, x.jsxDEV)(D, {
                  title: "Queue cleared",
                  text: "There are no pending leave requests awaiting decision."
                }, void 0, !1)
              ) : (
                pendingLeaves.slice(0, 3).map((l: any) => (0, x.jsxDEV)("div", {
                  className: "compact-row",
                  children: [
                    (0, x.jsxDEV)("div", {
                      className: "avatar",
                      children: (l.employee || "U").split(" ").map((w: string) => w[0]).join("").slice(0, 2)
                    }, void 0, !1),
                    (0, x.jsxDEV)("div", {
                      children: [
                        (0, x.jsxDEV)("strong", { children: l.employee }, void 0, !1),
                        (0, x.jsxDEV)("span", { children: `${l.type} leave · ${l.days} day(s) · ${l.start} to ${l.end}` }, void 0, !1)
                      ]
                    }, void 0, !0),
                    (0, x.jsxDEV)(T, {
                      variant: "ghost",
                      onClick: () => e.navigate("leave-admin"),
                      children: "Review"
                    }, void 0, !1)
                  ]
                }, l.id, !0))
              )
            ]
          }, void 0, !0),

          // Primary Admin Identity Card
          (0, x.jsxDEV)("section", {
            className: "card",
            children: [
              (0, x.jsxDEV)("div", {
                className: "card-head",
                children: (0, x.jsxDEV)("div", {
                  children: [
                    (0, x.jsxDEV)("span", { className: "eyebrow", children: "Security & Governance" }, void 0, !1),
                    (0, x.jsxDEV)("h2", { children: "Primary Administrator" }, void 0, !1)
                  ]
                }, void 0, !0)
              }, void 0, !1),
              (0, x.jsxDEV)("div", {
                style: { padding: "18px" },
                children: [
                  (0, x.jsxDEV)("div", {
                    style: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" },
                    children: [
                      (0, x.jsxDEV)("div", {
                        style: { width: "42px", height: "42px", background: "#0f293c", color: "#38a149", borderRadius: "10px", display: "grid", placeItems: "center", fontWeight: "800", fontSize: "16px" },
                        children: "H"
                      }, void 0, !1),
                      (0, x.jsxDEV)("div", {
                        children: [
                          (0, x.jsxDEV)("strong", { style: { display: "block", fontSize: "13px" }, children: "Hammad (Super Admin)" }, void 0, !1),
                          (0, x.jsxDEV)("span", { style: { fontSize: "11px", color: "var(--muted)" }, children: PRIMARY_SUPER_ADMIN_EMAIL }, void 0, !1)
                        ]
                      }, void 0, !0)
                    ]
                  }, void 0, !0),
                  (0, x.jsxDEV)(E, { tone: "danger", children: "Highest Governance Authority" }, void 0, !1),
                  (0, x.jsxDEV)("p", {
                    style: { fontSize: "11px", color: "var(--muted)", marginTop: "12px", lineHeight: "1.5" },
                    children: "Has exclusive permissions to provision administrators, alter governance roles, and manage company security policies."
                  }, void 0, !1)
                ]
              }, void 0, !0)
            ]
          }, void 0, !0)
        ]
      }, void 0, !0)
    ]
  }, void 0, !0);
}

// ------------------------------------------
// EMPLOYEE DIRECTORY (ADMIN)
// ------------------------------------------
function ye(e: any) {
  let [search, setSearch] = (0, b.useState)("");
  let filtered = e.employees.filter((emp: any) => `${emp.name} ${emp.email} ${emp.department}`.toLowerCase().includes(search.toLowerCase()));

  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Administration / People",
        title: "Employee directory",
        text: "Manage active records, access permissions, and organizational placement.",
        actions: (0, x.jsxDEV)(T, {
          variant: "primary",
          icon: "plus",
          onClick: () => e.open("employee"),
          children: "Add employee"
        }, void 0, !1)
      }, void 0, !1),

      (0, x.jsxDEV)("section", {
        className: "filterbar",
        children: [
          (0, x.jsxDEV)("div", {
            className: "search-field",
            children: [
              (0, x.jsxDEV)(w, { name: "search" }, void 0, !1),
              (0, x.jsxDEV)("input", {
                value: search,
                onChange: (ev: any) => setSearch(ev.target.value),
                placeholder: "Search employees..."
              }, void 0, !1)
            ]
          }, void 0, !0),
          (0, x.jsxDEV)(T, {
            icon: "download",
            onClick: () => e.notify("Employee roster exported"),
            children: "Export roster"
          }, void 0, !1)
        ]
      }, void 0, !0),

      (0, x.jsxDEV)("section", {
        className: "card table-card",
        children: [
          (0, x.jsxDEV)("div", {
            className: "table-scroll",
            children: (0, x.jsxDEV)("table", {
              children: [
                (0, x.jsxDEV)("thead", {
                  children: (0, x.jsxDEV)("tr", {
                    children: [
                      (0, x.jsxDEV)("th", { children: "Employee" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Department" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Role / Title" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Status" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Actions" }, void 0, !1)
                    ]
                  }, void 0, !0)
                }, void 0, !1),
                (0, x.jsxDEV)("tbody", {
                  children: filtered.map((emp: any) => (0, x.jsxDEV)("tr", {
                    children: [
                      (0, x.jsxDEV)("td", {
                        children: (0, x.jsxDEV)("div", {
                          className: "table-person",
                          children: [
                            (0, x.jsxDEV)("div", {
                              className: "avatar",
                              children: (emp.name || "U").split(" ").map((w: string) => w[0]).join("").slice(0, 2)
                            }, void 0, !1),
                            (0, x.jsxDEV)("div", {
                              children: [
                                (0, x.jsxDEV)("strong", { children: emp.name }, void 0, !1),
                                (0, x.jsxDEV)("small", { children: emp.email }, void 0, !1)
                              ]
                            }, void 0, !0)
                          ]
                        }, void 0, !0)
                      }, void 0, !1),
                      (0, x.jsxDEV)("td", { children: emp.department }, void 0, !1),
                      (0, x.jsxDEV)("td", { children: emp.title }, void 0, !1),
                      (0, x.jsxDEV)("td", {
                        children: (0, x.jsxDEV)(E, {
                          tone: emp.status === "Active" ? "success" : "neutral",
                          children: emp.status || "Active"
                        }, void 0, !1)
                      }, void 0, !1),
                      (0, x.jsxDEV)("td", {
                        children: (0, x.jsxDEV)("div", {
                          className: "inline-actions",
                          children: [
                            (0, x.jsxDEV)(T, {
                              variant: "ghost",
                              onClick: () => {
                                const newSt = emp.status === "Active" ? "Inactive" : "Active";
                                e.setEmployees((prev: any[]) => prev.map((item: any) => item.id === emp.id ? { ...item, status: newSt } : item));
                                e.notify(`${emp.name}'s status changed to ${newSt}`);
                              },
                              children: emp.status === "Active" ? "Deactivate" : "Activate"
                            }, void 0, !1),
                            emp.email !== PRIMARY_SUPER_ADMIN_EMAIL && (0, x.jsxDEV)(T, {
                              variant: "ghost",
                              onClick: () => e.ask({
                                text: `Remove ${emp.name} from directory?`,
                                action: () => {
                                  e.setEmployees((prev: any[]) => prev.filter((item: any) => item.id !== emp.id));
                                  e.notify(`${emp.name} removed`);
                                }
                              }),
                              children: "Remove"
                            }, void 0, !1)
                          ]
                        }, void 0, !0)
                      }, void 0, !1)
                    ]
                  }, emp.id || emp.email, !0))
                }, void 0, !1)
              ]
            }, void 0, !0)
          }, void 0, !1),

          filtered.length === 0 && (0, x.jsxDEV)(D, {
            title: "No employee records found",
            text: "No staff members matched your query. Click 'Add employee' to add a record."
          }, void 0, !1)
        ]
      }, void 0, !0)
    ]
  }, void 0, !0);
}

// ------------------------------------------
// TASK MANAGEMENT (ADMIN)
// ------------------------------------------
function be(e: any) {
  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Administration / Tasks",
        title: "Task management",
        text: "Assign work, establish deadlines, and monitor completion across teams.",
        actions: (0, x.jsxDEV)(T, {
          variant: "primary",
          icon: "plus",
          onClick: () => e.open("task"),
          children: "Assign task"
        }, void 0, !1)
      }, void 0, !1),

      (0, x.jsxDEV)("div", {
        className: "metrics",
        children: [
          (0, x.jsxDEV)(k, { label: "All tasks", value: String(e.tasks.length), helper: "Recorded assignments", icon: "tasks" }, void 0, !1),
          (0, x.jsxDEV)(k, { label: "In progress", value: String(e.tasks.filter((t: any) => t.status === "In Progress").length), helper: "Currently active", icon: "reports", tone: "green" }, void 0, !1),
          (0, x.jsxDEV)(k, { label: "Awaiting review", value: String(e.tasks.filter((t: any) => t.status === "In Review").length), helper: "Needs partner signoff", icon: "check", tone: "amber" }, void 0, !1)
        ]
      }, void 0, !0),

      (0, x.jsxDEV)("section", {
        className: "card table-card",
        children: (0, x.jsxDEV)("div", {
          className: "table-scroll",
          children: [
            (0, x.jsxDEV)("table", {
              children: [
                (0, x.jsxDEV)("thead", {
                  children: (0, x.jsxDEV)("tr", {
                    children: [
                      (0, x.jsxDEV)("th", { children: "Task" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Assignee" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Priority" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Due" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Status" }, void 0, !1),
                      (0, x.jsxDEV)("th", { children: "Actions" }, void 0, !1)
                    ]
                  }, void 0, !0)
                }, void 0, !1),
                (0, x.jsxDEV)("tbody", {
                  children: e.tasks.map((t: any) => (0, x.jsxDEV)("tr", {
                    children: [
                      (0, x.jsxDEV)("td", {
                        children: [
                          (0, x.jsxDEV)("strong", { children: t.title }, void 0, !1),
                          (0, x.jsxDEV)("br", {}, void 0, !1),
                          (0, x.jsxDEV)("small", { children: t.project }, void 0, !1)
                        ]
                      }, void 0, !0),
                      (0, x.jsxDEV)("td", { children: t.assignee }, void 0, !1),
                      (0, x.jsxDEV)("td", {
                        children: (0, x.jsxDEV)(E, { tone: t.priority === "Urgent" ? "danger" : "neutral", children: t.priority }, void 0, !1)
                      }, void 0, !1),
                      (0, x.jsxDEV)("td", { children: t.due }, void 0, !1),
                      (0, x.jsxDEV)("td", {
                        children: (0, x.jsxDEV)("select", {
                          value: t.status,
                          onChange: (ev: any) => {
                            const newSt = ev.target.value;
                            e.setTasks((prev: any[]) => prev.map((item: any) => item.id === t.id ? { ...item, status: newSt, progress: newSt === "Completed" ? 100 : item.progress } : item));
                            e.notify(`Task moved to ${newSt}`);
                          },
                          children: ["To Do", "In Progress", "In Review", "Completed"].map((s) => (0, x.jsxDEV)("option", { children: s }, s, !1))
                        }, void 0, !1)
                      }, void 0, !1),
                      (0, x.jsxDEV)("td", {
                        children: (0, x.jsxDEV)(T, {
                          variant: "ghost",
                          onClick: () => e.ask({
                            text: `Delete “${t.title}”?`,
                            action: () => {
                              e.setTasks((prev: any[]) => prev.filter((item: any) => item.id !== t.id));
                              e.notify("Task deleted");
                            }
                          }),
                          children: "Delete"
                        }, void 0, !1)
                      }, void 0, !1)
                    ]
                  }, t.id, !0))
                }, void 0, !1)
              ]
            }, void 0, !0),

            e.tasks.length === 0 && (0, x.jsxDEV)(D, {
              title: "No tasks created",
              text: "No active assignments exist. Click 'Assign task' to allocate work."
            }, void 0, !1)
          ]
        }, void 0, !0)
      }, void 0, !1)
    ]
  }, void 0, !0);
}

// ------------------------------------------
// ANNOUNCEMENT MANAGEMENT (ADMIN)
// ------------------------------------------
function A(e: any) {
  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Administration / Communications",
        title: "Announcement management",
        text: "Publish updates that immediately distribute across employee portals.",
        actions: (0, x.jsxDEV)(T, {
          variant: "primary",
          icon: "plus",
          onClick: () => e.open("announcement"),
          children: "Publish announcement"
        }, void 0, !1)
      }, void 0, !1),

      e.announcements.length === 0 ? (
        (0, x.jsxDEV)(D, {
          title: "No published announcements",
          text: "Click 'Publish announcement' to create the first company-wide circular."
        }, void 0, !1)
      ) : (
        (0, x.jsxDEV)("div", {
          className: "announcement-grid",
          children: e.announcements.map((a: any) => (0, x.jsxDEV)("article", {
            className: "announcement-card",
            children: [
              (0, x.jsxDEV)("div", {
                className: "announcement-meta",
                children: [
                  (0, x.jsxDEV)(E, { tone: "success", children: "Published" }, void 0, !1),
                  (0, x.jsxDEV)("span", { children: a.published }, void 0, !1)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)("h2", { children: a.title }, void 0, !1),
              (0, x.jsxDEV)("p", { children: a.body }, void 0, !1),
              (0, x.jsxDEV)("small", { children: ["Audience: ", a.audience] }, void 0, !0)
            ]
          }, a.id, !0))
        }, void 0, !1)
      )
    ]
  }, void 0, !0);
}

// ------------------------------------------
// LEAVE APPROVALS (ADMIN)
// ------------------------------------------
function xe(e: any) {
  let pending = e.leaves.filter((l: any) => l.status === "Pending");

  const decide = (l: any, dec: string) => e.ask({
    text: `${dec === "Approved" ? "Approve" : "Decline"} ${l.employee}'s ${l.type.toLowerCase()} leave request for ${l.days} day(s)?`,
    action: () => {
      e.setLeaves((prev: any[]) => prev.map((item: any) => item.id === l.id ? { ...item, status: dec } : item));
      e.notify(`${l.id} ${dec.toLowerCase()}; applicant notified`);
    }
  });

  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Administration / Leave",
        title: "Leave approvals",
        text: "Review submitted employee time-off applications."
      }, void 0, !1),

      (0, x.jsxDEV)("div", {
        className: "metrics",
        children: [
          (0, x.jsxDEV)(k, { label: "Pending review", value: String(pending.length), helper: "Awaiting decision", icon: "leave", tone: "amber" }, void 0, !1),
          (0, x.jsxDEV)(k, { label: "Approved", value: String(e.leaves.filter((l: any) => l.status === "Approved").length), helper: "Recorded approvals", icon: "check", tone: "green" }, void 0, !1),
          (0, x.jsxDEV)(k, { label: "Declined", value: String(e.leaves.filter((l: any) => l.status === "Declined").length), helper: "Decision history", icon: "close" }, void 0, !1)
        ]
      }, void 0, !0),

      pending.length === 0 ? (
        (0, x.jsxDEV)(D, {
          title: "Approval queue clear",
          text: "There are no pending employee leave requests requiring management review."
        }, void 0, !1)
      ) : (
        (0, x.jsxDEV)("div", {
          className: "approval-list",
          children: pending.map((l: any) => (0, x.jsxDEV)("article", {
            className: "approval-card",
            children: [
              (0, x.jsxDEV)("div", {
                className: "approval-main",
                children: [
                  (0, x.jsxDEV)("div", {
                    className: "avatar large",
                    children: (l.employee || "U").split(" ").map((w: string) => w[0]).join("").slice(0, 2)
                  }, void 0, !1),
                  (0, x.jsxDEV)("div", {
                    children: [
                      (0, x.jsxDEV)(E, { tone: "warning", children: `${l.id} · Pending review` }, void 0, !1),
                      (0, x.jsxDEV)("h2", { children: l.employee }, void 0, !1),
                      (0, x.jsxDEV)("p", { children: `${l.type} leave · ${l.start} to ${l.end} · ${l.days} working day(s)` }, void 0, !1),
                      (0, x.jsxDEV)("blockquote", { children: l.reason }, void 0, !1)
                    ]
                  }, void 0, !0)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)("div", {
                className: "approval-actions",
                children: [
                  (0, x.jsxDEV)(T, { variant: "danger", onClick: () => decide(l, "Declined"), children: "Decline" }, void 0, !1),
                  (0, x.jsxDEV)(T, { variant: "primary", onClick: () => decide(l, "Approved"), children: "Approve" }, void 0, !1)
                ]
              }, void 0, !0)
            ]
          }, l.id, !0))
        }, void 0, !1)
      )
    ]
  }, void 0, !0);
}

// ------------------------------------------
// ATTENDANCE MANAGEMENT (ADMIN)
// ------------------------------------------
function Se(e: any) {
  const activeStaff = e.employees.filter((emp: any) => emp.status === "Active").length;

  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Administration / Attendance",
        title: "Attendance management",
        text: "Monitor today's workforce check-ins and verify anomalies.",
        actions: (0, x.jsxDEV)(T, {
          icon: "download",
          onClick: () => e.notify("Attendance report exported"),
          children: "Export report"
        }, void 0, !1)
      }, void 0, !1),

      (0, x.jsxDEV)("div", {
        className: "metrics",
        children: [
          (0, x.jsxDEV)(k, { label: "Active staff", value: String(activeStaff), helper: "Total active consultants", icon: "users", tone: "green" }, void 0, !1),
          (0, x.jsxDEV)(k, { label: "Shift anomalies", value: "0", helper: "All check-ins verified", icon: "check" }, void 0, !1),
          (0, x.jsxDEV)(k, { label: "Approved leave", value: String(e.leaves.filter((l: any) => l.status === "Approved").length), helper: "Workforce schedule", icon: "leave" }, void 0, !1)
        ]
      }, void 0, !0),

      (0, x.jsxDEV)("section", {
        className: "card",
        children: [
          (0, x.jsxDEV)("div", {
            className: "card-head",
            children: (0, x.jsxDEV)("div", {
              children: [
                (0, x.jsxDEV)("span", { className: "eyebrow", children: "Today's Exceptions" }, void 0, !1),
                (0, x.jsxDEV)("h2", { children: "Compliance exceptions" }, void 0, !1)
              ]
            }, void 0, !0)
          }, void 0, !1),
          (0, x.jsxDEV)(D, {
            title: "No compliance exceptions",
            text: "All scheduled personnel are in compliance. No unexcused absences or missing check-outs."
          }, void 0, !1)
        ]
      }, void 0, !0)
    ]
  }, void 0, !0);
}

// ------------------------------------------
// NOTIFICATIONS INBOX
// ------------------------------------------
function Ce(e: any) {
  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Workspace / Notifications",
        title: "Notifications",
        text: "Workflow notices, security alerts, and updates.",
        actions: (0, x.jsxDEV)(T, {
          onClick: () => {
            e.setNotices((prev: any[]) => prev.map((item: any) => ({ ...item, read: true })));
            e.notify("All notifications marked as read");
          },
          children: "Mark all as read"
        }, void 0, !1)
      }, void 0, !1),

      e.notices.length === 0 ? (
        (0, x.jsxDEV)(D, {
          title: "Inbox is clean",
          text: "You have no unread notifications or workflow alerts."
        }, void 0, !1)
      ) : (
        (0, x.jsxDEV)("section", {
          className: "card notice-list",
          children: e.notices.map((n: any) => (0, x.jsxDEV)("button", {
            className: n.read ? "read" : "",
            onClick: () => e.setNotices((prev: any[]) => prev.map((item: any) => item.id === n.id ? { ...item, read: true } : item)),
            children: [
              (0, x.jsxDEV)("span", {
                className: "notice-symbol",
                children: (0, x.jsxDEV)(w, { name: (n.text || "").toLowerCase().includes("leave") ? "leave" : "tasks" }, void 0, !1)
              }, void 0, !1),
              (0, x.jsxDEV)("div", {
                children: [
                  (0, x.jsxDEV)("strong", { children: n.text }, void 0, !1),
                  (0, x.jsxDEV)("span", { children: `${n.time} ago` }, void 0, !1)
                ]
              }, void 0, !0),
              !n.read && (0, x.jsxDEV)("i", {}, void 0, !1)
            ]
          }, n.id, !0))
        }, void 0, !1)
      )
    ]
  }, void 0, !0);
}

// ------------------------------------------
// SETTINGS VIEW
// ------------------------------------------
function we(e: any) {
  let [emailDigest, setEmailDigest] = (0, b.useState)(true);
  let [desktopAlerts, setDesktopAlerts] = (0, b.useState)(true);

  return (0, x.jsxDEV)(x.Fragment, {
    children: [
      (0, x.jsxDEV)(ue, {
        eyebrow: "Workspace / Settings",
        title: "Workspace settings",
        text: "Manage application preferences, authentication status, and offline PWA settings."
      }, void 0, !1),

      (0, x.jsxDEV)("section", {
        className: "card settings-card",
        children: [
          (0, x.jsxDEV)("div", {
            children: [
              (0, x.jsxDEV)("h2", { children: "Notifications" }, void 0, !1),
              (0, x.jsxDEV)("p", { children: "Configure alerts and workflow summaries." }, void 0, !1)
            ]
          }, void 0, !0),

          (0, x.jsxDEV)("label", {
            children: [
              (0, x.jsxDEV)("div", {
                children: [
                  (0, x.jsxDEV)("strong", { children: "Email summaries" }, void 0, !1),
                  (0, x.jsxDEV)("span", { children: "Daily operational digest" }, void 0, !1)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)("input", {
                type: "checkbox",
                checked: emailDigest,
                onChange: (ev: any) => setEmailDigest(ev.target.checked)
              }, void 0, !1)
            ]
          }, void 0, !0),

          (0, x.jsxDEV)("label", {
            children: [
              (0, x.jsxDEV)("div", {
                children: [
                  (0, x.jsxDEV)("strong", { children: "Desktop alerts" }, void 0, !1),
                  (0, x.jsxDEV)("span", { children: "Immediate workflow notifications" }, void 0, !1)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)("input", {
                type: "checkbox",
                checked: desktopAlerts,
                onChange: (ev: any) => setDesktopAlerts(ev.target.checked)
              }, void 0, !1)
            ]
          }, void 0, !0)
        ]
      }, void 0, !0),

      (0, x.jsxDEV)("section", {
        className: "card settings-card",
        style: { marginTop: "16px" },
        children: [
          (0, x.jsxDEV)("div", {
            children: [
              (0, x.jsxDEV)("h2", { children: "Authentication & Security Architecture" }, void 0, !1),
              (0, x.jsxDEV)("p", { children: "Enterprise role-based security with Firebase Authentication and Firestore." }, void 0, !1)
            ]
          }, void 0, !0),
          (0, x.jsxDEV)("label", {
            children: [
              (0, x.jsxDEV)("div", {
                children: [
                  (0, x.jsxDEV)("strong", { children: "Primary Administrator" }, void 0, !1),
                  (0, x.jsxDEV)("span", { children: PRIMARY_SUPER_ADMIN_EMAIL }, void 0, !1)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)(E, { tone: "danger", children: "Super Admin" }, void 0, !1)
            ]
          }, void 0, !0),
          (0, x.jsxDEV)("label", {
            children: [
              (0, x.jsxDEV)("div", {
                children: [
                  (0, x.jsxDEV)("strong", { children: "Active Session" }, void 0, !1),
                  (0, x.jsxDEV)("span", { children: auth.currentUser?.email || e.currentUser?.email || "Authenticated" }, void 0, !1)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)(E, { tone: "success", children: (e.role || "employee").toUpperCase() }, void 0, !1)
            ]
          }, void 0, !0)
        ]
      }, void 0, !0),

      (0, x.jsxDEV)("section", {
        className: "card settings-card",
        style: { marginTop: "16px" },
        children: [
          (0, x.jsxDEV)("div", {
            children: [
              (0, x.jsxDEV)("h2", { children: "Progressive Web App (PWA)" }, void 0, !1),
              (0, x.jsxDEV)("p", { children: "Install GA Workspace on Windows 10/11 or desktop browsers for standalone window mode." }, void 0, !1)
            ]
          }, void 0, !0),
          (0, x.jsxDEV)("label", {
            children: [
              (0, x.jsxDEV)("div", {
                children: [
                  (0, x.jsxDEV)("strong", { children: "Application window mode" }, void 0, !1),
                  (0, x.jsxDEV)("span", { children: e.pwa?.isInstalled ? "Running as an installed standalone application" : "Running inside browser tab" }, void 0, !1)
                ]
              }, void 0, !0),
              (0, x.jsxDEV)(E, {
                tone: e.pwa?.isInstalled ? "success" : "neutral",
                children: e.pwa?.isInstalled ? "Standalone App" : "Web Browser"
              }, void 0, !1)
            ]
          }, void 0, !0),
          !e.pwa?.isInstalled && (0, x.jsxDEV)("div", {
            className: "settings-actions",
            children: (0, x.jsxDEV)(T, {
              variant: "primary",
              icon: "install",
              onClick: () => {
                if (e.pwa?.isInstallable) e.pwa.triggerInstall();
                else if (e.showInstallGuide) e.showInstallGuide();
              },
              children: e.pwa?.isInstallable ? "Install GA Workspace" : "Installation instructions"
            }, void 0, !1)
          }, void 0, !1)
        ]
      }, void 0, !0)
    ]
  }, void 0, !0);
}

// ------------------------------------------
// LEAVE APPLICATION MODAL
// ------------------------------------------
function j({ onClose, onSubmit, userName }: any) {
  let [type, setType] = (0, b.useState)("Annual");
  let [start, setStart] = (0, b.useState)("");
  let [end, setEnd] = (0, b.useState)("");
  let [reason, setReason] = (0, b.useState)("");
  let [errors, setErrors] = (0, b.useState)({});

  return (0, x.jsxDEV)(O, {
    title: "Apply for leave",
    onClose,
    children: (0, x.jsxDEV)("form", {
      onSubmit: (e: any) => {
        e.preventDefault();
        let errs: any = {};
        if (!start) errs.start = "Choose a start date";
        if (!end) errs.end = "Choose an end date";
        if (start && end && end < start) errs.end = "End date must be on or after start date";
        if (reason.trim().length < 8) errs.reason = "Please enter at least 8 characters explaining reason";

        setErrors(errs);
        if (Object.keys(errs).length) return;

        let days = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 864e5) + 1);
        onSubmit({
          id: `LR-${Math.floor(4000 + Math.random() * 5000)}`,
          employee: userName,
          type,
          start,
          end,
          days,
          reason: reason.trim(),
          status: "Pending"
        });
      },
      children: [
        (0, x.jsxDEV)("div", {
          className: "modal-body form-grid",
          children: [
            (0, x.jsxDEV)(ae, {
              label: "Leave type",
              children: (0, x.jsxDEV)("select", {
                value: type,
                onChange: (e: any) => setType(e.target.value),
                children: [
                  (0, x.jsxDEV)("option", { children: "Annual" }, void 0, !1),
                  (0, x.jsxDEV)("option", { children: "Sick" }, void 0, !1),
                  (0, x.jsxDEV)("option", { children: "Casual" }, void 0, !1)
                ]
              }, void 0, !0)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Start date",
              error: errors.start,
              children: (0, x.jsxDEV)("input", {
                type: "date",
                value: start,
                onChange: (e: any) => setStart(e.target.value)
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "End date",
              error: errors.end,
              children: (0, x.jsxDEV)("input", {
                type: "date",
                value: end,
                onChange: (e: any) => setEnd(e.target.value)
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Reason for absence",
              error: errors.reason,
              children: (0, x.jsxDEV)("textarea", {
                rows: 4,
                value: reason,
                onChange: (e: any) => setReason(e.target.value),
                placeholder: "Describe the reason for your time-off request..."
              }, void 0, !1)
            }, void 0, !1)
          ]
        }, void 0, !0),

        (0, x.jsxDEV)("div", {
          className: "modal-actions",
          children: [
            (0, x.jsxDEV)(T, { type: "button", onClick: onClose, children: "Cancel" }, void 0, !1),
            (0, x.jsxDEV)(T, { type: "submit", variant: "primary", children: "Submit Application" }, void 0, !1)
          ]
        }, void 0, !0)
      ]
    }, void 0, !0)
  }, void 0, !1);
}

// ------------------------------------------
// TASK CREATION MODAL
// ------------------------------------------
function Te({ employees, onClose, onSubmit }: any) {
  let [title, setTitle] = (0, b.useState)("");
  let [assignee, setAssignee] = (0, b.useState)(employees[0]?.name || "Unassigned");
  let [priority, setPriority] = (0, b.useState)("Medium");
  let [due, setDue] = (0, b.useState)("");
  let [error, setError] = (0, b.useState)("");

  return (0, x.jsxDEV)(O, {
    title: "Create and assign task",
    onClose,
    children: (0, x.jsxDEV)("form", {
      onSubmit: (e: any) => {
        e.preventDefault();
        if (title.trim().length < 3 || !due) {
          setError("Enter a descriptive title and select a due date.");
          return;
        }
        onSubmit({
          id: Date.now(),
          title: title.trim(),
          project: "Enterprise Advisory",
          priority,
          status: "To Do",
          due,
          assignee,
          progress: 0
        });
      },
      children: [
        (0, x.jsxDEV)("div", {
          className: "modal-body form-grid",
          children: [
            (0, x.jsxDEV)(ae, {
              label: "Task title",
              children: (0, x.jsxDEV)("input", {
                required: true,
                value: title,
                onChange: (e: any) => setTitle(e.target.value),
                placeholder: "e.g. Conduct Financial Risk Assessment"
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Assignee",
              children: (0, x.jsxDEV)("select", {
                value: assignee,
                onChange: (e: any) => setAssignee(e.target.value),
                children: employees.filter((emp: any) => emp.status === "Active").map((emp: any) => (0, x.jsxDEV)("option", { children: emp.name }, emp.id || emp.email, !1))
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Priority",
              children: (0, x.jsxDEV)("select", {
                value: priority,
                onChange: (e: any) => setPriority(e.target.value),
                children: [
                  (0, x.jsxDEV)("option", { children: "Medium" }, void 0, !1),
                  (0, x.jsxDEV)("option", { children: "High" }, void 0, !1),
                  (0, x.jsxDEV)("option", { children: "Urgent" }, void 0, !1)
                ]
              }, void 0, !0)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Due date",
              children: (0, x.jsxDEV)("input", {
                type: "date",
                required: true,
                value: due,
                onChange: (e: any) => setDue(e.target.value)
              }, void 0, !1)
            }, void 0, !1),

            error && (0, x.jsxDEV)("div", { className: "form-alert", children: error }, void 0, !1)
          ]
        }, void 0, !0),

        (0, x.jsxDEV)("div", {
          className: "modal-actions",
          children: [
            (0, x.jsxDEV)(T, { type: "button", onClick: onClose, children: "Cancel" }, void 0, !1),
            (0, x.jsxDEV)(T, { type: "submit", variant: "primary", children: "Create Task" }, void 0, !1)
          ]
        }, void 0, !0)
      ]
    }, void 0, !0)
  }, void 0, !1);
}

// ------------------------------------------
// EMPLOYEE CREATION MODAL
// ------------------------------------------
function Ee({ onClose, onSubmit }: any) {
  let [name, setName] = (0, b.useState)("");
  let [email, setEmail] = (0, b.useState)("");
  let [department, setDepartment] = (0, b.useState)("Enterprise Advisory");
  let [title, setTitle] = (0, b.useState)("Senior Consultant");
  let [error, setError] = (0, b.useState)("");

  return (0, x.jsxDEV)(O, {
    title: "Add employee to directory",
    onClose,
    children: (0, x.jsxDEV)("form", {
      onSubmit: (e: any) => {
        e.preventDefault();
        if (name.trim().length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setError("Complete every field and provide a valid work email address.");
          return;
        }
        onSubmit({
          id: "ga-" + email.trim().toLowerCase().replace(/[^a-z0-9]/g, "-"),
          name: name.trim(),
          email: email.trim().toLowerCase(),
          department,
          title,
          status: "Active"
        });
      },
      children: [
        (0, x.jsxDEV)("div", {
          className: "modal-body form-grid",
          children: [
            (0, x.jsxDEV)(ae, {
              label: "Full Name",
              children: (0, x.jsxDEV)("input", {
                required: true,
                value: name,
                onChange: (e: any) => setName(e.target.value),
                placeholder: "Full legal name"
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Work Email",
              children: (0, x.jsxDEV)("input", {
                type: "email",
                required: true,
                value: email,
                onChange: (e: any) => setEmail(e.target.value),
                placeholder: "name@growthalliance.net"
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Department",
              children: (0, x.jsxDEV)("input", {
                required: true,
                value: department,
                onChange: (e: any) => setDepartment(e.target.value)
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Job Title",
              children: (0, x.jsxDEV)("input", {
                required: true,
                value: title,
                onChange: (e: any) => setTitle(e.target.value)
              }, void 0, !1)
            }, void 0, !1),

            error && (0, x.jsxDEV)("div", { className: "form-alert", children: error }, void 0, !1)
          ]
        }, void 0, !0),

        (0, x.jsxDEV)("div", {
          className: "modal-actions",
          children: [
            (0, x.jsxDEV)(T, { type: "button", onClick: onClose, children: "Cancel" }, void 0, !1),
            (0, x.jsxDEV)(T, { type: "submit", variant: "primary", children: "Add to Directory" }, void 0, !1)
          ]
        }, void 0, !0)
      ]
    }, void 0, !0)
  }, void 0, !1);
}

// ------------------------------------------
// ANNOUNCEMENT PUBLISH MODAL
// ------------------------------------------
function De({ onClose, onSubmit }: any) {
  let [title, setTitle] = (0, b.useState)("");
  let [body, setBody] = (0, b.useState)("");
  let [audience, setAudience] = (0, b.useState)("All employees");
  let [error, setError] = (0, b.useState)("");

  return (0, x.jsxDEV)(O, {
    title: "Publish announcement",
    onClose,
    children: (0, x.jsxDEV)("form", {
      onSubmit: (e: any) => {
        e.preventDefault();
        if (title.trim().length < 5 || body.trim().length < 15) {
          setError("Please provide a title of at least 5 chars and body of at least 15 chars.");
          return;
        }
        onSubmit({
          id: Date.now(),
          title: title.trim(),
          body: body.trim(),
          audience,
          published: "Just now"
        });
      },
      children: [
        (0, x.jsxDEV)("div", {
          className: "modal-body form-grid",
          children: [
            (0, x.jsxDEV)(ae, {
              label: "Announcement title",
              children: (0, x.jsxDEV)("input", {
                required: true,
                value: title,
                onChange: (e: any) => setTitle(e.target.value),
                placeholder: "Clear, concise headline"
              }, void 0, !1)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Target Audience",
              children: (0, x.jsxDEV)("select", {
                value: audience,
                onChange: (e: any) => setAudience(e.target.value),
                children: [
                  (0, x.jsxDEV)("option", { children: "All employees" }, void 0, !1),
                  (0, x.jsxDEV)("option", { children: "Enterprise Advisory" }, void 0, !1),
                  (0, x.jsxDEV)("option", { children: "Strategy & Risk" }, void 0, !1),
                  (0, x.jsxDEV)("option", { children: "Executive Leadership" }, void 0, !1)
                ]
              }, void 0, !0)
            }, void 0, !1),

            (0, x.jsxDEV)(ae, {
              label: "Message",
              children: (0, x.jsxDEV)("textarea", {
                rows: 6,
                required: true,
                value: body,
                onChange: (e: any) => setBody(e.target.value),
                placeholder: "Write the announcement message..."
              }, void 0, !1)
            }, void 0, !1),

            error && (0, x.jsxDEV)("div", { className: "form-alert", children: error }, void 0, !1)
          ]
        }, void 0, !0),

        (0, x.jsxDEV)("div", {
          className: "modal-actions",
          children: [
            (0, x.jsxDEV)(T, { type: "button", onClick: onClose, children: "Cancel" }, void 0, !1),
            (0, x.jsxDEV)(T, { type: "submit", variant: "primary", children: "Publish Now" }, void 0, !1)
          ]
        }, void 0, !0)
      ]
    }, void 0, !0)
  }, void 0, !1);
}

// ------------------------------------------
// LOADING SKELETON
// ------------------------------------------
function Oe() {
  return (0, x.jsxDEV)("div", {
    className: "loading-state",
    "aria-label": "Loading workspace",
    children: [
      (0, x.jsxDEV)("div", { className: "skeleton title" }, void 0, !1),
      (0, x.jsxDEV)("div", { className: "skeleton subtitle" }, void 0, !1),
      (0, x.jsxDEV)("div", {
        className: "skeleton-grid",
        children: [1, 2, 3, 4].map((e) => (0, x.jsxDEV)("div", { className: "skeleton card-skeleton" }, e, !1))
      }, void 0, !1),
      (0, x.jsxDEV)("div", { className: "skeleton panel-skeleton" }, void 0, !1)
    ]
  }, void 0, !0);
}

export default ce;
