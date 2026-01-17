'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

export default function ProfilePage() {
  const supabase = createClient();

  // Personal info states
  const [ageRange, setAgeRange] = useState('');
  const [familySituation, setFamilySituation] = useState('');
  const [retirementYear, setRetirementYear] = useState('');
  const [dependents, setDependents] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Password reset
  const [resetSent, setResetSent] = useState(false);

  // MFA states (moved from dashboard)
  const [mfaStatus, setMfaStatus] = useState<'checking' | 'prompt' | 'verified' | 'none'>('checking');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState<string | null>(null);

  // Load profile data
  useEffect(() => {
    loadProfile();
    checkMfa();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Assuming we have a profiles table
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (profile) {
          setAgeRange(profile.age_range || '');
          setFamilySituation(profile.family_situation || '');
          setRetirementYear(profile.retirement_year || '');
          setDependents(profile.dependents || '');
        }
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('profiles')
          .upsert({
            user_id: user.id,
            age_range: ageRange,
            family_situation: familySituation,
            retirement_year: retirementYear,
            dependents: dependents,
          });
        alert('Profile saved successfully!');
      }
    } catch (err) {
      console.error('Failed to save profile:', err);
      alert('Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) {
        await supabase.auth.resetPasswordForEmail(user.email);
        setResetSent(true);
      }
    } catch (err) {
      console.error('Password reset failed:', err);
      alert('Failed to send password reset email');
    }
  };

  const checkMfa = async () => {
    try {
      const { data: aalData, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalErr) throw aalErr;
      const { currentLevel, nextLevel } = aalData ?? {};
      if (currentLevel === 'aal1' && nextLevel === 'aal2') {
        setMfaStatus('prompt');
      } else if (currentLevel === 'aal1') {
        setMfaStatus('verified'); // Allow access but show prompt
      } else {
        setMfaStatus('verified');
      }
    } catch (err) {
      console.error('AAL check failed:', err);
      setMfaStatus('none');
    }
  };

  const handleMfaVerify = async () => {
    setMfaError(null);
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp?.find(f => f.status === 'verified');
      if (!factor?.id) throw new Error('No verified TOTP factor found');

      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code: mfaCode.trim(),
      });

      if (error) throw error;

      setMfaStatus('verified');
    } catch (err: any) {
      setMfaError(err.message || 'Verification failed');
    }
  };

  if (loading) {
    return <div className="container mx-auto p-6">Loading profile...</div>;
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">User Profile</h1>

      <div className="grid gap-8">
        {/* Personal Information */}
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <p className="text-sm text-muted-foreground">
              This information helps Grok provide more personalized portfolio advice. All data is genericized for privacy.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="ageRange">Age Range</Label>
              <Select value={ageRange} onValueChange={setAgeRange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select age range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="18-24">18-24</SelectItem>
                  <SelectItem value="25-34">25-34</SelectItem>
                  <SelectItem value="35-44">35-44</SelectItem>
                  <SelectItem value="45-54">45-54</SelectItem>
                  <SelectItem value="55-64">55-64</SelectItem>
                  <SelectItem value="65+">65+</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="familySituation">Family Situation</Label>
              <Select value={familySituation} onValueChange={setFamilySituation}>
                <SelectTrigger>
                  <SelectValue placeholder="Select family situation" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single</SelectItem>
                  <SelectItem value="married">Married</SelectItem>
                  <SelectItem value="divorced">Divorced</SelectItem>
                  <SelectItem value="widowed">Widowed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="retirementYear">Desired Retirement Year</Label>
              <Input
                id="retirementYear"
                type="number"
                value={retirementYear}
                onChange={(e) => setRetirementYear(e.target.value)}
                placeholder="e.g., 2045"
              />
            </div>

            <div>
              <Label htmlFor="dependents">Number of Dependents</Label>
              <Input
                id="dependents"
                type="number"
                value={dependents}
                onChange={(e) => setDependents(e.target.value)}
                placeholder="e.g., 2"
              />
            </div>

            <Button onClick={saveProfile} disabled={saving}>
              {saving ? 'Saving...' : 'Save Profile'}
            </Button>
          </CardContent>
        </Card>

        {/* Password Reset */}
        <Card>
          <CardHeader>
            <CardTitle>Password Reset</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Click the button below to receive a password reset email.
            </p>
            <Button onClick={handlePasswordReset} disabled={resetSent}>
              {resetSent ? 'Reset Email Sent' : 'Send Password Reset Email'}
            </Button>
          </CardContent>
        </Card>

        {/* MFA Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Multi-Factor Authentication</CardTitle>
          </CardHeader>
          <CardContent>
            {mfaStatus === 'checking' && <p>Checking MFA status...</p>}
            {mfaStatus === 'prompt' && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code from your authenticator app to verify your identity.
                </p>
                <Input
                  placeholder="000000"
                  value={mfaCode}
                  onChange={(e: any) => setMfaCode(e.target.value)}
                  maxLength={6}
                  className="text-center text-2xl tracking-widest"
                />
                {mfaError && <p className="text-red-500 text-sm">{mfaError}</p>}
                <Button onClick={handleMfaVerify} disabled={!mfaCode.trim()}>
                  Verify
                </Button>
              </div>
            )}
            {mfaStatus === 'verified' && (
              <div className="space-y-4">
                <p className="text-green-600">MFA is enabled and verified.</p>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline">Setup New MFA Device</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Setup MFA</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will redirect you to the MFA setup page.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => window.location.href = '/settings/mfa'}>
                        Continue
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )}
            {mfaStatus === 'none' && (
              <div className="space-y-4">
                <p>MFA is not set up.</p>
                <Button onClick={() => window.location.href = '/settings/mfa'}>
                  Setup MFA
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Multi-User Access */}
        <Card>
          <CardHeader>
            <CardTitle>Multi-User Access</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Under Construction</p>
            <p className="text-sm text-muted-foreground">
              This feature will allow you to grant access to your account for spouses, advisors, or other trusted individuals with view-only or edit permissions.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}