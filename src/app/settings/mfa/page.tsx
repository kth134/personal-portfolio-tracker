'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function MFASettings() {
  const supabase = createClient()

  const [qrUri, setQrUri] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [verifyAttempts, setVerifyAttempts] = useState(0)
  const [lastAttempt, setLastAttempt] = useState(0)

  useEffect(() => {
    loadFactors()
  }, [])

  const loadFactors = async () => {
    setLoading(true)
    const { data, error } = await supabase.auth.mfa.listFactors()
    setLoading(false)

    if (error) {
      const sanitizedError = error.message.replace(/[<>\"'&]/g, '')
      setError(sanitizedError)
      console.error('MFA load error:', sanitizedError)
      return
    }

    setSuccess(!!data?.totp?.some(f => f.status === 'verified'))
  }

  const enroll = async () => {
    setError(null)
    setQrUri(null)
    setSecret(null)
    setFactorId(null)
    setLoading(true)

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
    })

    setLoading(false)

    if (error) {
      const sanitizedError = error.message.replace(/[<>\"'&]/g, '')
      setError(sanitizedError)
      console.error('MFA enroll error:', sanitizedError)
      return
    }

    if (data?.totp?.qr_code && data.totp.secret && (data.totp as any).id) {
      setQrUri(data.totp.qr_code)
      setSecret(data.totp.secret)
      setFactorId((data.totp as any).id)
    } else {
      setError('Incomplete enrollment data returned from Supabase')
    }
  }

  const verify = async () => {
    setError(null)
    setLoading(true)

    // Basic client-side rate limiting: max 5 attempts per minute
    const now = Date.now()
    if (verifyAttempts >= 5 && now - lastAttempt < 60000) {
      setError('Too many verification attempts. Please wait 1 minute.')
      setLoading(false)
      return
    }

    if (!factorId) {
      setError('No factor ID available – please enroll again')
      setLoading(false)
      return
    }

    try {
      // Step 1: Challenge the factor to start verification session
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      })

      if (challengeError) throw challengeError

      const challengeId = challengeData?.id
      if (!challengeId) throw new Error('No challenge ID received')

      // Step 2: Verify with code + challengeId
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: verifyCode.trim(),
      })

      if (verifyError) throw verifyError

      setSuccess(true)
      setQrUri(null)
      setSecret(null)
      setFactorId(null)
      setVerifyCode('')
      setVerifyAttempts(0) // Reset on success
      loadFactors() // refresh
    } catch (err: any) {
      const sanitizedError = (err.message || 'Verification failed').replace(/[<>\"'&]/g, '') // Basic sanitization
      setError(sanitizedError)
      setVerifyAttempts(prev => prev + 1)
      setLastAttempt(Date.now())
      console.error('MFA verification error:', sanitizedError) // Log without sensitive data
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto space-y-6 p-6">
      <h1 className="text-2xl font-bold">Multi-Factor Authentication (TOTP)</h1>

      {success ? (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
          MFA is now enabled! Your authenticator app provides an extra layer of security.
        </div>
      ) : (
        <>
          <p className="text-muted-foreground">
            Add an authenticator app (Google Authenticator, Authy, etc.) for extra security.
          </p>

          <Button
            onClick={enroll}
            disabled={!!factorId || loading}
            className="w-full"
          >
            {loading ? 'Processing...' : factorId ? 'QR Code Ready' : 'Enable MFA'}
          </Button>

          {factorId && qrUri && (
            <div className="space-y-6 border rounded-lg p-6 bg-white shadow-sm">
              <p className="font-medium text-center">Scan this QR code with your authenticator app:</p>

              <div className="flex justify-center items-center bg-white p-6 rounded-lg border border-gray-200 max-w-[280px] mx-auto">
                <div 
                  className="w-full max-w-[240px] h-auto"
                  dangerouslySetInnerHTML={{ __html: qrUri.replace(/<script[^>]*>.*?<\/script>/gi, '') }} // Strip any scripts
                />
              </div>

              <p className="text-sm text-muted-foreground text-center">
                Or manually enter this secret key:<br />
                <strong className="font-mono break-all select-all bg-gray-100 px-1 py-0.5 rounded">
                  {secret}
                </strong>
              </p>

              <Input
                placeholder="Enter 6-digit code"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                maxLength={6}
                className="text-center text-xl tracking-widest font-mono"
                disabled={loading}
              />

              <Button
                onClick={verify}
                className="w-full"
                disabled={verifyCode.length !== 6 || loading}
              >
                {loading ? 'Verifying...' : 'Verify & Activate'}
              </Button>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}
        </>
      )}

      {loading && !qrUri && (
        <p className="text-center text-sm text-muted-foreground">Loading MFA status...</p>
      )}
    </div>
  )
}