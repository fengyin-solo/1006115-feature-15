import { defineStore } from 'pinia'
import type { ActorRole } from '@/data/types'

// 只有拌制站负责人能改配方、调判定标准；其他值班人员只读、只能走核对与流转。
export const ROLES: ActorRole[] = ['值班管理员', '拌制站负责人']

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: '值班管理员' as ActorRole,
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isMortarOwner: (state) => state.role === '拌制站负责人',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: ActorRole) {
      this.role = role
      this.operator = role
    },
  },
})
