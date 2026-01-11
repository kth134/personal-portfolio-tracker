'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function MFASettings() {
  const supabase = createClient()

  const [qrUri, setQrUri] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadFactors()
  }, [])

  const loadFactors = async () => {
    setLoading(true)
    const { data, error } = await supabase.auth.mfa.listFactors()
    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setSuccess(!!data?.totp?.some(f => f.status === 'verified'))
  }

  const enroll = async () => {
    setError(null)
    setQrUri(null)
    setSecret(null)
    setLoading(true)

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    if (data?.totp?.qr_code) {
      setQrUri(data.totp.qr_code)
      setSecret(data.totp.secret)
    } else {
      setError('No QR code returned from Supabase')
    }
  }

  const verify = async () => {
    setError(null)
    setLoading(true)

    try {
      // Step 1: List factors to get the pending one
      const { data: factorsData, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError || !factorsData?.totp?.length) {
        throw new Error('No TOTP factor found – try enrolling again')
      }

      const factor = factorsData.totp.find((f: any) => f.status === 'unverified') || factorsData.totp[0]
      const factorId = factor.id

      // Step 2: Challenge the factor to start verification session
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      })

      if (challengeError) throw challengeError

      const challengeId = challengeData?.id
      if (!challengeId) throw new Error('No challenge ID received')

      // Step 3: Verify with code + challengeId
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: verifyCode.trim(),
      })

      if (verifyError) throw verifyError

      setSuccess(true)
      setQrUri(null)
      setSecret(null)
      setVerifyCode('')
      loadFactors() // refresh
    } catch (err: any) {
      setError(err.message || 'Verification failed')
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
            disabled={!!qrUri || loading}
            className="w-full"
          >
            {loading ? 'Processing...' : qrUri ? 'QR Code Ready' : 'Enable MFA'}
          </Button>

          {qrUri && (
            <div className="space-y-6 border rounded-lg p-6 bg-white shadow-sm">
              <p className="font-medium text-center">Scan this QR code with your authenticator app:</p>

              <div className="flex justify-center items-center bg-white p-6 rounded-lg border border-gray-200 max-w-[280px] mx-auto">
                <div 
                  className="w-full max-w-[240px] h-auto"
                  dangerouslySetInnerHTML={{ __html: qrUri }}
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