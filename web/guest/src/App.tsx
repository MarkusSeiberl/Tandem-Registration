import { useState } from 'react'
import Welcome from './Welcome'
import Form from './Form'
import type { FormValues } from './Form'
import Contract from './Contract'
import Done from './Done'
import HiddenSettings from './HiddenSettings'
import { submitRegistration } from './api'
import { splitServerErrors } from './serverErrors'
import type { ServerFieldErrors } from './serverErrors'

type Screen = 'welcome' | 'form' | 'contract' | 'done'

// A guest mid-flow always knows how much of Form -> Contract is left. Said in
// words as well as dots: two unlabelled dots read as decoration, not progress.
function StepTicks({ step }: { step: 0 | 1 }) {
  return (
    <div className="step-ticks">
      <span className={`step-tick ${step > 0 ? 'done' : 'active'}`} aria-hidden="true" />
      <span className={`step-tick ${step === 1 ? 'active' : ''}`} aria-hidden="true" />
      <span className="step-label">Schritt {step + 1} von 2</span>
    </div>
  )
}

function App() {
  const [screen, setScreen] = useState<Screen>('welcome')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [formValues, setFormValues] = useState<FormValues | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitErrors, setSubmitErrors] = useState<string[] | null>(null)
  const [fieldErrors, setFieldErrors] = useState<ServerFieldErrors | null>(null)

  function resetToWelcome() {
    setScreen('welcome')
    setFormValues(null)
    setSubmitErrors(null)
    setFieldErrors(null)
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
      // A rejected field is fixed where it was typed, not read about under the
      // contract. The signature goes with it, as it does on "Zurück".
      const { fields, other } = splitServerErrors(result.errors)
      if (Object.keys(fields).length > 0) {
        setFieldErrors(fields)
        setScreen('form')
      } else {
        setSubmitErrors(other)
      }
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
              setFieldErrors(null)
              setScreen('contract')
            }}
            onCancel={resetToWelcome}
            initialValues={formValues}
            serverErrors={fieldErrors}
          />
        </>
      )}
      {screen === 'contract' && (
        <>
          <StepTicks step={1} />
          <Contract
            onNext={handleSign}
            onCancel={resetToWelcome}
            minor={formValues !== null && formValues.age < 18}
            passenger={
              formValues
                ? {
                    name: `${formValues.first_name} ${formValues.last_name}`,
                    address: `${formValues.street}, ${formValues.postal_code} ${formValues.city}`,
                  }
                : undefined
            }
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
      {screen === 'done' && (
        <Done firstName={formValues?.first_name} onTimeout={resetToWelcome} />
      )}

      {settingsOpen && <HiddenSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default App
