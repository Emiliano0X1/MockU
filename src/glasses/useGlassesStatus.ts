import { DeviceConnectType } from '@evenrealities/even_hub_sdk'
import { useEffect, useState } from 'react'
import { getBridge } from './bridge'

export type GlassesStatus = { available: boolean; connected: boolean; battery?: number }

export function useGlassesStatus(): GlassesStatus {
  const [status, setStatus] = useState<GlassesStatus>({ available: false, connected: false })

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let cancelled = false
    getBridge().then((bridge) => {
      if (!bridge || cancelled) return
      setStatus((s) => ({ ...s, available: true }))
      unsubscribe = bridge.onDeviceStatusChanged((device) => {
        setStatus({
          available: true,
          connected: device.connectType === DeviceConnectType.Connected,
          battery: device.batteryLevel,
        })
      })
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return status
}
