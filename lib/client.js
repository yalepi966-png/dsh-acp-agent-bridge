/**
 * Browser half: one sidebar footer action that opens the bridge panel.
 * Hand-written bundle for the DSH client module loader; no build step.
 * The panel talks to the host page server over HTTP on localhost.
 */
window.__ModuleLoader__.load({
  id: 'dsh-acp-agent-bridge',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    let BASE = localStorage.getItem('agent-bridge-base') || 'http://127.0.0.1:4319'

    const call = async (path, init) => {
      const response = await fetch(BASE + path, init)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    const styles = {
      row: {
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 10px',
        border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer',
        font: 'inherit', textAlign: 'left', borderRadius: 8,
      },
      dot: { width: 8, height: 8, borderRadius: 4, background: '#3ba55d', flex: 'none' },
      overlay: {
        position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', justifyContent: 'flex-end',
        background: 'rgba(0,0,0,.28)',
      },
      panel: {
        width: 520, maxWidth: '92vw', height: '100%', overflowY: 'auto', padding: '18px 20px',
        background: 'Canvas', color: 'CanvasText', borderLeft: '1px solid rgba(127,127,127,.35)',
        font: '14px/1.6 -apple-system, "PingFang SC", "Segoe UI", sans-serif', boxSizing: 'border-box',
      },
      card: {
        border: '1px solid rgba(127,127,127,.35)', borderRadius: 10, padding: '12px 14px', marginTop: 14,
      },
      head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
      badge: { fontSize: 12, opacity: .75 },
      label: { display: 'block', fontSize: 12, opacity: .7, margin: '10px 0 4px' },
      input: {
        width: '100%', boxSizing: 'border-box', padding: '6px 9px', borderRadius: 7, font: 'inherit',
        border: '1px solid rgba(127,127,127,.45)', background: 'transparent', color: 'inherit',
      },
      button: {
        padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(127,127,127,.45)',
        background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', marginTop: 10,
      },
      switch: (on) => ({
        width: 44, height: 24, borderRadius: 999, cursor: 'pointer', flex: 'none',
        border: `1px solid ${on ? '#3ba55d' : 'rgba(127,127,127,.5)'}`, background: 'transparent',
        position: 'relative', padding: 0,
      }),
      knob: (on) => ({
        position: 'absolute', top: 2, left: on ? 21 : 3, width: 18, height: 18, borderRadius: 9,
        background: on ? '#3ba55d' : 'rgba(127,127,127,.7)', transition: 'left .15s ease',
      }),
      hint: { fontSize: 12, opacity: .65, marginTop: 8, wordBreak: 'break-all' },
      error: { color: '#c0392b', fontSize: 12, marginTop: 8 },
    }

    function PortCard({ port, onApplied }) {
      const [value, setValue] = useState(String(port))
      const [status, setStatus] = useState('')
      const [busy, setBusy] = useState(false)

      const check = async () => {
        setBusy(true)
        try {
          const result = await call(`/api/port?port=${encodeURIComponent(value)}`)
          setStatus(result.current ? `端口 ${result.port} 是当前端口` : result.free ? `端口 ${result.port} 空闲` : `端口 ${result.port} 已被占用`)
        } catch (failure) {
          setStatus(failure.message)
        } finally {
          setBusy(false)
        }
      }

      const apply = async () => {
        setBusy(true)
        try {
          const result = await call('/api/port', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ port: Number(value) }),
          })
          if (result.pageUrl) {
            BASE = result.pageUrl.replace(/\/$/, '')
            localStorage.setItem('agent-bridge-base', BASE)
          }
          onApplied(result)
          setStatus(`已切换并重启服务：${BASE}`)
        } catch (failure) {
          setStatus(failure.message)
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: styles.card },
        h('div', { style: styles.head }, h('strong', null, '服务端口'), h('span', { style: styles.badge }, `当前 ${port}`)),
        h('label', { style: styles.label }, '端口（1-65535，先检测再确定）'),
        h('div', { style: { display: 'flex', gap: 8 } },
          h('input', { style: styles.input, value, onChange: (event) => setValue(event.target.value) }),
          h('button', { style: { ...styles.button, marginTop: 0 }, disabled: busy, onClick: check }, '检测'),
          h('button', { style: { ...styles.button, marginTop: 0 }, disabled: busy, onClick: apply }, '确定')),
        status ? h('div', { style: styles.hint }, status) : null)
    }

    function AgentCard({ agent, onSave, busy }) {
      const [path, setPath] = useState(agent.command)
      useEffect(() => { setPath(agent.command) }, [agent.command])
      return h('div', { style: styles.card },
        h('div', { style: styles.head },
          h('strong', null, agent.label),
          h('span', { style: styles.badge },
            agent.detection.available
              ? `可用 · ${agent.detection.version || ''}`
              : `不可用 · ${agent.detection.reason || '未探测'}`)),
        h('label', { style: styles.label }, `CLI 路径（留空按 ${agent.effectiveCommand} 自动探测）`),
        h('input', {
          style: styles.input, value: path, placeholder: agent.effectiveCommand,
          onChange: (event) => setPath(event.target.value),
        }),
        h('div', { style: styles.hint }, `ACP 适配器：${agent.adapterPackage} · 工具${agent.registered ? '已注册' : '未注册'}`),
        h('button', { style: styles.button, disabled: busy, onClick: () => onSave({ command: path }) }, '保存'),
      )
    }

    function Panel({ onClose }) {
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        try {
          setState(await call('/api/state'))
          setError('')
        } catch (failure) {
          setError(`连不上本地桥服务（${BASE}）：${failure.message}`)
        }
      }, [])

      useEffect(() => { void load() }, [load])

      const save = async (id, patch) => {
        setBusy(true)
        try {
          setState(await call(`/api/agents/${id}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
          }))
          setError('')
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: styles.overlay, onClick: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { style: styles.panel },
          h('div', { style: styles.head },
            h('strong', null, '外部 Agent 桥'),
            h('button', { style: { ...styles.button, marginTop: 0 }, onClick: onClose }, '关闭')),
          h('div', { style: styles.hint }, state ? `配置：${state.configPath}` : '加载中…'),
          state ? h(PortCard, { port: state.port, onApplied: (next) => setState(next) }) : null,
          error ? h('div', { style: styles.error }, error) : null,
          ...(state ? state.agents.map((agent) => h(AgentCard, {
            key: agent.id, agent, busy, onSave: (patch) => save(agent.id, patch),
          })) : []),
          h('button', {
            style: styles.button,
            onClick: async () => {
              try { setState(await call('/api/probe', { method: 'POST' })) } catch (failure) { setError(failure.message) }
            },
          }, '全部重新探测'),
        ),
      )
    }

    function AgentBridgeSidebar(props) {
      const [open, setOpen] = useState(false)
      return h(React.Fragment, null,
        h('button', { style: styles.row, title: '外部 Agent 桥', onClick: () => setOpen(true) },
          h('span', { style: styles.dot }),
          props.wide === false ? null : h('span', null, '外部 Agent')),
        open ? h(Panel, { onClose: () => setOpen(false) }) : null,
      )
    }

    function apply(ctx) {
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'agent-bridge',
        order: -20,
      }, AgentBridgeSidebar))
    }

    return { apply, inject: ['slots'] }
  },
})
