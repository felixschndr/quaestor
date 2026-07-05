import { useEffect, useRef } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'

import { useAuthMe, type CredentialRead } from '@/lib/auth'
import { CredentialDetailView } from '@/pages/settings.credentials.$credentialId'

export const Route = createFileRoute('/settings/credentials/$credentialId')({
  component: CredentialDetailPage,
})

function CredentialDetailPage() {
  const { credentialId } = Route.useParams()
  const { data: user } = useAuthMe()
  const router = useRouter()
  const credential = user?.credentials.find((c) => c.id === Number(credentialId))

  const hadCredential = useRef(false)
  useEffect(() => {
    if (credential) {
      hadCredential.current = true
    } else if (hadCredential.current && user) {
      router.history.push('/settings/credentials')
    }
  }, [credential, user, router])

  if (!user) return null // root guard already redirected on 401

  return (
    <CredentialDetailView
      credential={credential}
      onDeleted={() => router.history.push('/settings/credentials')}
    />
  )
}

export interface CredentialDetailViewProps {
  credential: CredentialRead | undefined
  onDeleted: () => void
}
