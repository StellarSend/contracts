import { Slider } from "@workspace/ui/components/slider"
import { Badge } from "@workspace/ui/components/badge"

type LeverageSliderProps = {
  min?: number
  max?: number
  step?: number
  value: number
  onChange: (value: number) => void
}

export function LeverageSlider({ min = 1, max = 50, step = 0.5, value, onChange }: LeverageSliderProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Leverage</span>
        <Badge variant="secondary">{value}×</Badge>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
        className="w-full"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{min}×</span>
        <span>{max}×</span>
      </div>
    </div>
  )
}
