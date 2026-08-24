/**
 * A guest mid-flow always knows how much of Form -> Contract is left.
 *
 * Rendered by each screen inside its own head band rather than beside the
 * screen: anything outside `.screen` is outside the shell that keeps the page
 * from scrolling. It lives here rather than in App.tsx because App imports the
 * screens that need it, and the reverse import would close a cycle.
 */
export default function StepTicks({ step }: { step: 0 | 1 }) {
  return (
    <div className="step-ticks" aria-hidden="true">
      <span className={`step-tick ${step > 0 ? 'done' : 'active'}`} />
      <span className={`step-tick ${step === 1 ? 'active' : ''}`} />
    </div>
  )
}
