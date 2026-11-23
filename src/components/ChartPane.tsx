import { ColorType, createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { useEffect, useRef } from 'react'
import type { Candle, Quote } from '../types'

export function ChartPane({ candles, quote }: { candles: Candle[]; quote: Quote | null }) {
  const host = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)

  useEffect(() => {
    const node = host.current
    if (!node) return
    const chart = createChart(node, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#000000' },
        textColor: '#71767b',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      },
      grid: {
        vertLines: { color: '#16181c' },
        horzLines: { color: '#16181c' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: '#2f3336', labelBackgroundColor: '#16181c' },
        horzLine: { color: '#2f3336', labelBackgroundColor: '#16181c' },
      },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#000000',
      downColor: '#71767b',
      borderVisible: true,
      borderUpColor: '#e7e9ea',
      borderDownColor: '#71767b',
      wickUpColor: '#e7e9ea',
      wickDownColor: '#71767b',
    })
    chartRef.current = chart
    seriesRef.current = series
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    series.setData(
      candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    )
    chartRef.current?.timeScale().fitContent()
  }, [candles])

  useEffect(() => {
    const series = seriesRef.current
    const last = candles.at(-1)
    if (!series || !quote || !last) return
    series.update({
      time: last.time as UTCTimestamp,
      open: last.open,
      high: Math.max(last.high, quote.price),
      low: Math.min(last.low, quote.price),
      close: quote.price,
    })
  }, [candles, quote])

  return <div className="chart" ref={host} />
}
