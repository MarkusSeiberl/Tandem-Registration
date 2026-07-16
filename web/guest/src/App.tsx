import { useState } from 'react'
import Welcome from './Welcome'
import Contract from './Contract'
import Form from './Form'
import type { FormValues } from './Form'
import Sign from './Sign'
import Done from './Done'
import HiddenSettings from './HiddenSettings'
import { submitRegistration } from './api'

type Screen = 'welcome' | 'contract' | 'form' | 'sign' | 'done'

function App() {
  const [screen, setScreen] = useState<Screen>('welcome')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [formValues, setFormValues] = useState<FormValues | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitErrors, setSubmitErrors] = useState<string[] | null>(null)

  function resetToWelcome() {
    setScreen('welcome')
    setFormValues(null)
    setSubmitErrors(null)
    setSubmitting(false)
  }

  async function handleSign(signaturePng: string) {
    if (!formValues) return
    setSubmitting(true)
    setSubmitErrors(null)
    const result = await submitRegistration({
      ...formValues,
      signature_png: signaturePng,
      accepted_terms: true,
    })
    setSubmitting(false)
    if (result.ok) {
      setScreen('done')
    } else {
      setSubmitErrors(result.errors)
    }
  }

  return (
    <div className="app-root">
      {screen === 'welcome' && (
        <Welcome
          onStart={() => setScreen('contract')}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {screen === 'contract' && (
        <Contract onNext={() => setScreen('form')} onCancel={resetToWelcome} />
      )}
      {screen === 'form' && (
        <Form
          onNext={(values) => {
            setFormValues(values)
            setScreen('sign')
          }}
          onCancel={resetToWelcome}
        />
      )}
      {screen === 'sign' && (
        <Sign
          onNext={handleSign}
          onCancel={resetToWelcome}
          submitting={submitting}
          errors={submitErrors}
        />
      )}
      {screen === 'done' && <Done onTimeout={resetToWelcome} />}

      {settingsOpen && <HiddenSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default App
