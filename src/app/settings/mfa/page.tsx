'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client' // your browser client
// @ts-ignore
import QRCode from 'qrcode.react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function MFASettings() {
  const supabase = createClient()
  const [qrUri, setQrUri] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [factors, setFactors] = useState<any[]>([])

  useEffect(() => {
    loadFactors()
  }, [])

  const loadFactors = async () => {
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) {
      setError(error.message)
      return
    }
    setFactors(data.all || [])
    // If already verified TOTP exists → show success
    if (data.totp?.some(f => f.status === 'verified')) {
      setSuccess(true)
    }
  }

  const enroll = async () => {
    setError(null)
    setQrUri(null)
    setSecret(null)

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      // optional: friendly_name: 'My Authenticator App'
    })

    if (error) {
      setError(error.message)
      return
    }

    if (data?.totp?.qr_code) { // SVG string
      setQrUri(data.totp.qr_code)
      setSecret(data.totp.secret)
    }
  }

  const verify = async () => {
    setError(null)

    const { data: factorsData, error: listError } = await supabase.auth.mfa.listFactors()
    if (listError || !factorsData?.totp?.length) {
      setError('No pending factor found')
      return
    }

    // Use the most recent unverified TOTP (or first)
    const factor = factorsData.totp.find((f: any) => f.status === 'unverified') || factorsData.totp[0]
    const factorId = factor.id

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      code: verifyCode.trim(),
      challengeId: (factor as any).challenge_id || '',
    })

    if (verifyError) {
      setError(verifyError.message)
      return
    }

    setSuccess(true)
    setQrUri(null)
    setSecret(null)
    setVerifyCode('')
    loadFactors() // refresh
  }

  return (
    <div className="max-w-md mx-auto space-y-6 p-6">
      <h1 className="text-2xl font-bold">Multi-Factor Authentication</h1>

      {success ? (
        <div className="p-4 border rounded bg-green-50 text-green-800">
          MFA is enabled! You now have an extra layer of security.
        </div>
      ) : (
        <>
          <p className="text-muted-foreground">
            Add an authenticator app (Google Authenticator, Authy, etc.) for extra security.
          </p>

          <Button onClick={enroll} disabled={!!qrUri}>
            {qrUri ? 'QR Code Generated' : 'Enable MFA'}
          </Button>

          {qrUri && (
            <div className="space-y-4 border p-4 rounded">
              <p>Scan this QR code with your authenticator app:</p>
              <div className="flex justify-center">
                <QRCode value={qrUri} size={200} />
              </div>
              <p className="text-sm text-muted-foreground">
                Or manually enter secret: <strong>{secret}</strong>
              </p>

              <Input
                placeholder="Enter 6-digit code from app"
                value={verifyCode}
                onChange={e => setVerifyCode(e.target.value)}
                maxLength={6}
              />

              <Button onClick={verify} className="w-full">
                Verify & Activate
              </Button>
            </div>
          )}

          {error && <p className="text-red-500">{error}</p>}
        </>
      )}

      {/* Optional: List existing factors / disable button later */}
    </div>
  )
}