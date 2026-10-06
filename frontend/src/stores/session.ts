import { defineStore } from 'pinia'
import type { StationRole } from '@/data/mortar-types'

export const ROLE_OPTIONS: StationRole[] = ['拌制站负责人', '值班管理员']

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员' as StationRole,
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    // 配方与判定标准只有拌制站负责人能改。
    isStationManager: (state) => state.operator === '拌制站负责人',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: StationRole) {
      this.operator = role
    },
  },
})
