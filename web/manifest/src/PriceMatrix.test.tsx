import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import PriceMatrix from './PriceMatrix'
import type { Prices } from './api'

const PRICES: Prices = {
  jump: 270, video: 100, video_photo: 120, weight_over_90: 40, weight_over_100: 60,
}

// Every row as the text of its cells, header row first.
const cells = () =>
  screen.getAllByRole('row').map((row) => Array.from(row.children).map((c) => c.textContent))

describe('PriceMatrix', () => {
  it('shows the final price of every combination', () => {
    render(<PriceMatrix prices={PRICES} />)

    expect(screen.getByRole('heading', { name: 'Endpreise' })).toBeInTheDocument()
    expect(cells()).toEqual([
      ['', 'ohne Zuschlag', 'ab 90 kg', 'ab 100 kg'],
      ['Tandem', '270 €', '310 €', '330 €'],
      ['Tandem + Video', '370 €', '410 €', '430 €'],
      ['Tandem + Video + Foto', '390 €', '430 €', '450 €'],
    ])
  })

  it('blanks only the cells that need a missing price', () => {
    const { video: _video, ...withoutVideo } = PRICES
    render(<PriceMatrix prices={withoutVideo} />)

    expect(cells()).toEqual([
      ['', 'ohne Zuschlag', 'ab 90 kg', 'ab 100 kg'],
      ['Tandem', '270 €', '310 €', '330 €'],
      ['Tandem + Video', '–', '–', '–'],
      ['Tandem + Video + Foto', '390 €', '430 €', '450 €'],
    ])
  })

  it('blanks a surcharge column when its surcharge is missing', () => {
    const { weight_over_100: _w, ...withoutOver100 } = PRICES
    render(<PriceMatrix prices={withoutOver100} />)

    expect(cells().slice(1).map((row) => row[3])).toEqual(['–', '–', '–'])
    expect(cells()[1][2]).toBe('310 €')
  })
})
