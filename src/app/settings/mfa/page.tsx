'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface TOTPData {
  id: string;
  qr_code: string;
  secret: string;
  uri: string;
  status: string;
  type: string;
}

export default function MFASettings() {
  const supabase = createClient()

  const [user, setUser] = useState<{ id: string } | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [qrUri, setQrUri] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [verifyAttempts, setVerifyAttempts] = useState(0)
  const [lastAttempt, setLastAttempt] = useState(0)

  const loadFactors = useCallback(async () => {
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
  }, []) // Remove user dependency

  const checkAuth = useCallback(async () => {
    setAuthLoading(true)
    const { data: { user }, error } = await supabase.auth.getUser()
    setAuthLoading(false)

    if (error || !user) {
      setError('Authentication required. Please log in to manage MFA settings.')
      return
    }

    setUser(user)
    loadFactors()
  }, []) // Remove loadFactors dependency

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  const enroll = async () => {
    if (!user) {
      setError('Authentication required. Please log in to manage MFA settings.')
      return
    }

    setError(null)
    setQrUri(null)
    setSecret(null)
    setFactorId(null)
    setLoading(true)

    // First, check for existing unverified TOTP factors
    const { data: existingFactors, error: listError } = await supabase.auth.mfa.listFactors()
    
    if (listError) {
      console.error('Failed to list existing factors:', listError)
      setLoading(false)
      setError('Failed to check existing MFA factors')
      return
    }

    const existingUnverifiedTotp = existingFactors?.totp?.find((f: any) => f.status === 'unverified')

    if (existingUnverifiedTotp) {
      // Reuse existing unverified factor
      console.log('Found existing unverified TOTP factor, reusing it')
      setFactorId(existingUnverifiedTotp.id)
      // For existing factors, we need to generate a new challenge to get QR code
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: existingUnverifiedTotp.id,
      })

      if (challengeError) {
        console.error('Failed to challenge existing factor:', challengeError)
        setLoading(false)
        setError('Failed to setup existing MFA factor')
        return
      }

      // Note: challenge doesn't return QR code, we need to unenroll and re-enroll
      // For now, let's unenroll the existing factor and create a new one
      await supabase.auth.mfa.unenroll({ factorId: existingUnverifiedTotp.id })
    }

    // Now enroll a new TOTP factor
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
    })

    setLoading(false)

    console.log('MFA enroll response:', { data, error }) // Debug log

    if (error) {
      const sanitizedError = error.message.replace(/[<>\"'&]/g, '')
      setError(sanitizedError)
      console.error('MFA enroll error:', sanitizedError)
      return
    }

    if (data?.totp) {
      const totp = data.totp as any // Type assertion to access id
      const missingFields = []
      
      if (!totp.qr_code) missingFields.push('qr_code')
      if (!totp.secret) missingFields.push('secret') 
      
      // ID is optional - we'll get it from listFactors if not provided
      if (missingFields.length > 0) {
        console.error('Missing fields in enrollment response:', missingFields)
        setError(`Incomplete enrollment data: missing ${missingFields.join(', ')}`)
        return
      }
      
      setQrUri(totp.qr_code)
      setSecret(totp.secret)
      
      // If ID is provided, use it; otherwise, we'll get it from listFactors
      if (totp.id) {
        setFactorId(totp.id)
      } else {
        // Fallback: list factors to find the newly enrolled one
        console.log('ID not provided in enrollment, listing factors...')
        const { data: factorsData, error: listError } = await supabase.auth.mfa.listFactors()
        if (listError) {
          console.error('Failed to list factors after enrollment:', listError)
          setError('Failed to retrieve enrollment data')
          return
        }
        
        const newFactor = factorsData?.totp?.find((f: any) => f.status === 'unverified')
        if (newFactor?.id) {
          setFactorId(newFactor.id)
        } else {
          setError('Could not find enrolled MFA factor')
          return
        }
      }
    } else {
      console.error('No TOTP data in enrollment response')
      setError('No TOTP data returned from Supabase')
    }
  }

  const verify = async () => {
    if (!user) {
      setError('Authentication required. Please log in to manage MFA settings.')
      setLoading(false)
      return
    }

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
    } catch (err: unknown) {
      const error = err as Error
      const sanitizedError = (error.message || 'Verification failed').replace(/[<>\"'&]/g, '') // Basic sanitization
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

      {authLoading ? (
        <p className="text-center text-sm text-muted-foreground">Checking authentication...</p>
      ) : !user ? (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          Authentication required. Please log in to manage MFA settings.
        </div>
      ) : success ? (
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
            disabled={!!factorId || loading || !user}
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

      {loading && !qrUri && user && (
        <p className="text-center text-sm text-muted-foreground">Loading MFA status...</p>
      )}
    </div>
  )
}