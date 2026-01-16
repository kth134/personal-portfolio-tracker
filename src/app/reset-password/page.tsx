'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [verified, setVerified] = useState(false)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const verifyRecovery = async () => {
      setLoading(true)
      setError(null)

      const accessToken = searchParams.get('access_token')
      const refreshToken = searchParams.get('refresh_token')
      const type = searchParams.get('type')

      if (!accessToken || !refreshToken || type !== 'recovery') {
        setError('Invalid or missing recovery token.')
        setLoading(false)
        return
      }

      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })

      if (error) {
        console.error('Set session error:', error)
        setError(error.message || 'Failed to verify reset link. Try requesting a new one.')
      } else {
        setVerified(true)
      }
      setLoading(false)
    }

    verifyRecovery()
  }, [searchParams])

  const handleUpdate = async () => {
    setError(null)
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setError(error.message || 'Failed to update password.')
    } else {
      setSuccess(true)
      setTimeout(() => router.push('/dashboard'), 3000)
    }
  }

  if (loading) {
    return <div className="container mx-auto p-6 text-center">Verifying reset link...</div>
  }

  if (!verified) {
    return (
      <div className="container mx-auto max-w-md p-6">
        <h1 className="text-2xl font-bold mb-4">Invalid Link</h1>
        <p className="text-red-500 mb-4">{error}</p>
        <Button variant="link" onClick={() => router.push('/login')}>
          Back to Login
        </Button>
      </div>
    )
  }

  if (success) {
    return (
      <div className="container mx-auto max-w-md p-6 text-center">
        <h1 className="text-2xl font-bold mb-4">Password Updated</h1>
        <p>Success! Redirecting to login...</p>
      </div>
    )
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
      <Button onClick={handleUpdate} className="w-full" disabled={loading}>
        Update Password
      </Button>
    </div>
  )
}

export default function ResetPassword() {
  return (
    <Suspense fallback={<div className="container mx-auto p-6 text-center">Loading...</div>}>
      <ResetPasswordContent />
    </Suspense>
  )
}