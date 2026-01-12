'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'  // ← new import
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRouter } from 'next/navigation'
import { IconBrandGoogle } from '@tabler/icons-react'  // optional

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState('')
  const [loginAttempts, setLoginAttempts] = useState(0)
  const [lastLoginAttempt, setLastLoginAttempt] = useState(0)
  const router = useRouter()
  const supabase = createClient()

  const handleSocialLogin = async () => {
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      const sanitizedError = error.message.replace(/[<>\"'&]/g, '')
      setError(sanitizedError)
      console.error('OAuth error:', sanitizedError)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Basic client-side rate limiting: max 5 attempts per minute
    const now = Date.now()
    if (loginAttempts >= 5 && now - lastLoginAttempt < 60000) {
      setError('Too many login attempts. Please wait 1 minute.')
      return
    }

    // Basic input validation
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoginAttempts(prev => prev + 1)
    setLastLoginAttempt(now)

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password })
      if (error) {
        const sanitizedError = error.message.replace(/[<>\"'&]/g, '')
        setError(sanitizedError)
        console.error('Sign up error:', sanitizedError)
      } else if (data.session) {
        router.push('/dashboard')
      } else {
        setError('Check email for confirmation link. Then log in.')
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
      if (error) {
        const sanitizedError = error.message.replace(/[<>\"'&]/g, '')
        setError(sanitizedError)
        console.error('Sign in error:', sanitizedError)
      } else {
        setLoginAttempts(0) // Reset on success
        router.push('/dashboard')
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 w-80">
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error && <p className="text-red-500">{error}</p>}
      <Button type="submit" className="w-full">{isSignUp ? 'Sign Up' : 'Log In'}</Button>

      {/* Optional OR divider */}
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
        <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">Or</span></div>
      </div>

      <Button type="button" variant="outline" className="w-full" onClick={handleSocialLogin}>
        {IconBrandGoogle && <IconBrandGoogle className="mr-2 h-4 w-4" />}
        Login with Google
      </Button>

      <Button type="button" variant="secondary" onClick={() => setIsSignUp(!isSignUp)}>
        {isSignUp ? 'Already have account? Log In' : 'Need account? Sign Up'}
      </Button>
    </form>
  )
}