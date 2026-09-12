/**
 * 联动规则求值器的跨端一致性测试（前端侧）
 *
 * 用例来自 logic-cases.json —— 后端 JUnit 读的是同一份。任一侧行为漂移，那一侧就会红。
 *
 * 这不是「顺手也测一下」：服务端复校验的前提就是两边算出同样的结果。
 * 前端说某字段必填、后端提交时算出不必填，用户会遇到「该拦的没拦住」；
 * 反过来则是「界面上填完了但提交被拒」。两种都很难查。
 */
import { describe, expect, it } from 'vitest'
import cases from './logic-cases.json'
import { MAX_PASSES, evaluateLogicRules, stateOf } from './evaluator'
import type { FieldState, LogicRule, LogicTrigger } from './types'

interface ExpectedState {
  visible?: boolean
  editable?: boolean
  required?: boolean
}

interface LogicCase {
  name: string
  trigger?: string
  baseState?: Record<string, ExpectedState>
  data?: Record<string, any>
  rules?: LogicRule[]
  expect?: {
    state?: Record<string, ExpectedState>
    data?: Record<string, any>
    stable?: boolean
  }
}

const caseFile = cases as any

describe('联动规则求值器', () => {
  it('⚠️ 迭代轮数必须与用例集声明的一致，两端也必须一致', () => {
    expect(
      MAX_PASSES,
      '求值器的 MAX_PASSES 与用例集声明不一致。两边轮数不同会让' +
        '「刚好在第 N 轮收敛」的规则集在一侧算出结果、另一侧算不出'
    ).toBe(caseFile.maxPasses)
  })

  it('用例集不是空的', () => {
    expect(Array.isArray(caseFile.cases)).toBe(true)
    expect(caseFile.cases.length).toBeGreaterThan(0)
  })

  describe('共享用例集', () => {
    for (const c of caseFile.cases as LogicCase[]) {
      it(c.name, () => {
        const trigger = (c.trigger ?? 'CHANGE') as LogicTrigger

        const baseState: Record<string, FieldState> = {}
        if (c.baseState) {
          for (const [field, want] of Object.entries(c.baseState)) {
            baseState[field] = {
              visible: want.visible ?? true,
              editable: want.editable ?? true,
              required: want.required ?? false
            }
          }
        }

        const data = c.data ? { ...c.data } : {}
        const dataSnapshot = JSON.stringify(data)

        const result = evaluateLogicRules(c.rules, trigger, data, baseState)

        // 求值器不得修改入参 data —— 调用方常把响应式表单数据直接传进来，
        // 就地修改会触发意料之外的响应式更新，也会让「原始值」这个信息丢掉
        expect(JSON.stringify(data), `[${c.name}] 求值器修改了入参 data`).toBe(dataSnapshot)

        const want = c.expect
        expect(want, `[${c.name}] 用例没写 expect`).toBeTruthy()
        if (!want) return

        if (want.stable !== undefined) {
          expect(result.stable, `[${c.name}] stable 不符`).toBe(want.stable)
        }
        if (want.state) {
          for (const [field, ws] of Object.entries(want.state)) {
            const got = stateOf(result, field)
            if (ws.visible !== undefined) {
              expect(got.visible, `[${c.name}] 字段 ${field} 的 visible 不符`).toBe(ws.visible)
            }
            if (ws.editable !== undefined) {
              expect(got.editable, `[${c.name}] 字段 ${field} 的 editable 不符`).toBe(ws.editable)
            }
            if (ws.required !== undefined) {
              expect(got.required, `[${c.name}] 字段 ${field} 的 required 不符`).toBe(ws.required)
            }
          }
        }
        if (want.data) {
          for (const [field, wv] of Object.entries(want.data)) {
            const got = result.data[field]
            // 数值用宽松比较：JSON 里的 2 与规则赋的 2 类型一致，
            // 但用例若写 2.0 就会变成不同的字面量，不该因此失败
            if (typeof wv === 'number' && typeof got === 'number') {
              expect(got, `[${c.name}] 字段 ${field} 的值不符`).toBe(wv)
            } else {
              expect(got, `[${c.name}] 字段 ${field} 的值不符`).toEqual(wv)
            }
          }
        }
      })
    }
  })
})
