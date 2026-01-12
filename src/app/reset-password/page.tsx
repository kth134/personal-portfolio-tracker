'use client'

import { useEffect, useState, Suspense } from 'react'; // ← Add Suspense import
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const verifyRecovery = async () => {
      setLoading(true);
      const hash = searchParams.get('code');
      const type = searchParams.get('type');
      if (hash && type === 'recovery') {
        const { error } = await supabase.auth.verifyOtp({
          type: 'recovery',
          token_hash: hash,
        });
        if (error) {
          setError(error.message.replace(/[<>\"'&]/g, ''));
        } else {
          setVerified(true);
        }
      } else {
        setError('Invalid or missing recovery token.');
      }
      setLoading(false);
    };

    verifyRecovery();
  }, [searchParams]);

  const handleUpdate = async () => {
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setError(error.message.replace(/[<>\"'&]/g, ''));
    } else {
      setSuccess(true);
      setTimeout(() => router.push('/login'), 3000);
    }
  };

  if (loading) {
    return <div className="container mx-auto p-6 text-center">Verifying recovery link...</div>;
  }

  if (!verified) {
    return (
      <div className="container mx-auto max-w-md p-6">
        <h1 className="text-2xl font-bold mb-4">Invalid Link</h1>
        <p className="text-red-500">{error}</p>
        <Button variant="link" onClick={() => router.push('/login')}>Back to Login</Button>
      </div>
    );
  }

  if (success) {
    return (
      <div className="container mx-auto max-w-md p-6 text-center">
        <h1 className="text-2xl font-bold mb-4">Password Updated</h1>
        <p>Your password has been reset successfully. Redirecting to login...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-md p-6 space-y-6">
      <h1 className="text-2xl font-bold">Set New Password</h1>
      <div>
        <Label htmlFor="new-password">New Password</Label>
        <Input
          id="new-password"
          type="password"
          value={newPassword}
          onChange={e => setNewPassword(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="confirm-password">Confirm Password</Label>
        <Input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
        />
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <Button onClick={handleUpdate} className="w-full">Update Password</Button>
    </div>
  );
}

export default function ResetPassword() {
  return (
    <Suspense fallback={<div className="container mx-auto p-6 text-center">Loading...</div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}