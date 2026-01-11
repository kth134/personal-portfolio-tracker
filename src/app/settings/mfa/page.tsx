'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client' // your browser client
import { QRCodeSVG } from 'qrcode.react' // ← FIXED: named import (SVG version)
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

    const factors = data?.all || []
    setSuccess(!!data?.totp?.some(f => f.status === 'verified'))
  }

  const enroll = async () => {
    setError(null)
    setQrUri(null)
    setSecret(null)
    setLoading(true)

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      // optional: friendly_name: 'Portfolio Tracker App'
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    if (data?.totp?.qr_code) {
      setQrUri(data.totp.qr_code) // SVG string
      setSecret(data.totp.secret)
    }
  }

  const verify = async () => {
    setError(null)
    setLoading(true)

    const { data: factorsData, error: listError } = await supabase.auth.mfa.listFactors()
    if (listError || !factorsData?.totp?.length) {
      setError('No pending factor found')
      setLoading(false)
      return
    }

    // Prefer unverified → fallback to first
    const factor = factorsData.totp.find((f: any) => f.status === 'unverified') || factorsData.totp[0]
    const factorId = factor.id

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      code: verifyCode.trim(),
      challengeId: (factor as any).challenge_id || '',
    })

    setLoading(false)

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
      <h1 className="text-2xl font-bold">Multi-Factor Authentication (TOTP)</h1>

      {success ? (
        <div className="p-4 border rounded-lg bg-green-50 text-green-800">
          MFA is now enabled! Your authenticator app provides an extra layer of security.
        </div>
      ) : (
        <>
          <p className="text-muted-foreground">
            Protect your portfolio data by adding an authenticator app (Google Authenticator, Authy, Microsoft Authenticator, etc.).
          </p>

          <Button 
            onClick={enroll} 
            disabled={!!qrUri || loading}
            className="w-full"
          >
            {loading ? 'Processing...' : qrUri ? 'QR Ready' : 'Enable MFA'}
          </Button>

          {qrUri && (
            <div className="space-y-4 border rounded-lg p-6 bg-muted/40">
              <p className="font-medium">Scan this QR code:</p>
              <div className="flex justify-center py-4">
                <QRCodeSVG 
                  value={qrUri} 
                  size={200} 
                  level="M" // Medium error correction – good balance
                />
              </div>

              <p className="text-sm text-muted-foreground text-center">
                Or manually enter this secret key:<br/>
                <strong className="font-mono break-all">{secret}</strong>
              </p>

              <Input
                placeholder="Enter 6-digit code"
                value={verifyCode}
                onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ''))} // only digits
                maxLength={6}
                className="text-center text-xl tracking-widest"
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
            <div className="p-4 border rounded-lg bg-red-50 text-red-800">
              {error}
            </div>
          )}
        </>
      )}

      {loading && !qrUri && (
        <p className="text-center text-sm text-muted-foreground">Loading factors...</p>
      )}
    </div>
  )
}