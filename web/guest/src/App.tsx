import { useState } from 'react'
import Welcome from './Welcome'
import Form from './Form'
import type { FormValues } from './Form'
import Contract from './Contract'
import Done from './Done'
import HiddenSettings from './HiddenSettings'
import { submitRegistration } from './api'

type Screen = 'welcome' | 'form' | 'contract' | 'done'

// A guest mid-flow always knows how much of Form -> Contract is left.
function StepTicks({ step }: { step: 0 | 1 }) {
  return (
    <div className="step-ticks" aria-hidden="true">
      <span className={`step-tick ${step > 0 ? 'done' : 'active'}`} />
      <span className={`step-tick ${step === 1 ? 'active' : ''}`} />
    </div>
  )
}

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
      // Contract.tsx will not call onNext without the box ticked, so reaching
      // this line already means the guest acknowledged the notice.
      privacy_ack: true,
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
          onStart={() => setScreen('form')}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {screen === 'form' && (
        <>
          <StepTicks step={0} />
          <Form
            onNext={(values) => {
              setFormValues(values)
              setScreen('contract')
            }}
            onCancel={resetToWelcome}
            initialValues={formValues}
          />
        </>
      )}
      {screen === 'contract' && (
        <>
          <StepTicks step={1} />
          <Contract
            onNext={handleSign}
            onCancel={resetToWelcome}
            // Back to the form with everything still in it. The signature is
            // not kept: it belongs to the data it was drawn under, and that is
            // exactly what the guest went back to change.
            onBack={() => {
              setSubmitErrors(null)
              setScreen('form')
            }}
            submitting={submitting}
            errors={submitErrors}
          />
        </>
      )}
      {screen === 'done' && <Done onTimeout={resetToWelcome} />}

      {settingsOpen && <HiddenSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default App
