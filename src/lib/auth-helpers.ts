import { auth } from './auth';
import { redirect } from 'next/navigation';

/**
 * Get the current session (server-side)
 */
export async function getSession() {
  return await auth();
}

/**
 * Check if the current user is authenticated
 */
export async function isAuthenticated() {
  const session = await auth();
  return !!session?.user;
}

/**
 * Check if the current user is an admin
 */
export async function isAdmin() {
  const session = await auth();
  return session?.user?.role === 'ADMIN';
}

/**
 * Require authentication - redirect to sign in if not authenticated
 */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    redirect('/auth/signin');
  }
  return session;
}

/**
 * Require admin role - redirect if not admin
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user) {
    redirect('/auth/signin');
  }
  if (session.user.role !== 'ADMIN') {
    redirect('/');
  }
  return session;
}

/**
 * Check if an email is the admin email (for first-time setup)
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const adminEmail = process.env.ADMIN_EMAIL;
  return adminEmail ? email.toLowerCase() === adminEmail.toLowerCase() : false;
}
