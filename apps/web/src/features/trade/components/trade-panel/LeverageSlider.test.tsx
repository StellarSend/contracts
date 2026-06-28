import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { LeverageSlider } from "./LeverageSlider"

// The Slider component (Base UI) renders a visually-hidden <input type="range">
// for accessibility. Use { hidden: true } when querying role="slider".
function getSlider() {
  return screen.getByRole("slider", { hidden: true }) as HTMLInputElement
}

afterEach(() => {
  cleanup()
})

describe("LeverageSlider", () => {
  describe("rendering", () => {
    it("displays the current leverage value", () => {
      render(<LeverageSlider min={1} max={50} value={10} onChange={vi.fn()} />)
      expect(screen.getByText("10×")).toBeInTheDocument()
    })

    it("displays the min label", () => {
      render(<LeverageSlider min={1} max={50} value={10} onChange={vi.fn()} />)
      expect(screen.getByText("1×")).toBeInTheDocument()
    })

    it("displays the max label", () => {
      render(<LeverageSlider min={1} max={50} value={10} onChange={vi.fn()} />)
      expect(screen.getByText("50×")).toBeInTheDocument()
    })

    it("renders custom min and max labels", () => {
      render(<LeverageSlider min={2} max={20} value={5} onChange={vi.fn()} />)
      expect(screen.getByText("2×")).toBeInTheDocument()
      expect(screen.getByText("20×")).toBeInTheDocument()
    })

    it("sets slider min bound via the min attribute", () => {
      render(<LeverageSlider min={2} max={20} value={5} onChange={vi.fn()} />)
      expect(getSlider()).toHaveAttribute("min", "2")
    })

    it("sets slider max bound via the max attribute", () => {
      render(<LeverageSlider min={2} max={20} value={5} onChange={vi.fn()} />)
      expect(getSlider()).toHaveAttribute("max", "20")
    })

    it("sets aria-valuenow to the current value", () => {
      render(<LeverageSlider min={1} max={50} value={15} onChange={vi.fn()} />)
      expect(getSlider()).toHaveAttribute("aria-valuenow", "15")
    })
  })

  describe("keyboard interaction", () => {
    it("calls onChange with incremented value on ArrowRight", async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<LeverageSlider min={1} max={50} step={1} value={10} onChange={onChange} />)
      const slider = getSlider()
      slider.focus()
      await user.keyboard("{ArrowRight}")
      expect(onChange).toHaveBeenCalledWith(11)
    })

    it("calls onChange with decremented value on ArrowLeft", async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<LeverageSlider min={1} max={50} step={1} value={10} onChange={onChange} />)
      const slider = getSlider()
      slider.focus()
      await user.keyboard("{ArrowLeft}")
      expect(onChange).toHaveBeenCalledWith(9)
    })

    it("calls onChange with a larger step on PageUp", async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<LeverageSlider min={1} max={50} step={1} value={10} onChange={onChange} />)
      const slider = getSlider()
      slider.focus()
      await user.keyboard("{PageUp}")
      expect(onChange).toHaveBeenCalled()
      const newVal = onChange.mock.calls[0][0] as number
      expect(newVal).toBeGreaterThan(10)
    })
  })

  describe("clamping", () => {
    it("does not fire onChange when already at min and ArrowLeft is pressed", async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<LeverageSlider min={1} max={50} step={1} value={1} onChange={onChange} />)
      const slider = getSlider()
      slider.focus()
      await user.keyboard("{ArrowLeft}")
      expect(onChange).not.toHaveBeenCalled()
    })

    it("does not fire onChange when already at max and ArrowRight is pressed", async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<LeverageSlider min={1} max={50} step={1} value={50} onChange={onChange} />)
      const slider = getSlider()
      slider.focus()
      await user.keyboard("{ArrowRight}")
      expect(onChange).not.toHaveBeenCalled()
    })

    it("jumps to max on End key", async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<LeverageSlider min={1} max={50} step={1} value={10} onChange={onChange} />)
      const slider = getSlider()
      slider.focus()
      await user.keyboard("{End}")
      expect(onChange).toHaveBeenCalledWith(50)
    })

    it("jumps to min on Home key", async () => {
      const onChange = vi.fn()
      const user = userEvent.setup()
      render(<LeverageSlider min={1} max={50} step={1} value={10} onChange={onChange} />)
      const slider = getSlider()
      slider.focus()
      await user.keyboard("{Home}")
      expect(onChange).toHaveBeenCalledWith(1)
    })
  })
})
