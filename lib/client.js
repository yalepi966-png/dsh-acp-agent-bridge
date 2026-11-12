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

    let BASE = 'http://127.0.0.1:4319'
    try {
      BASE = localStorage.getItem('agent-bridge-base') || BASE
    } catch {
      // Storage can be unavailable in a sandboxed webview; the default still works.
    }

    const call = async (path, init) => {
      const response = await fetch(BASE + path, init)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    const CSS = `
      .ab-row{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .16s ease}
      .ab-row:hover{background:rgba(255,255,255,.55)}
      .ab-row .ab-dot{width:8px;height:8px;border-radius:50%;flex:none;background:linear-gradient(135deg,#9be8c8,#7bd3ae);box-shadow:0 0 0 3px rgba(155,232,200,.22)}
      .ab-overlay{position:fixed;inset:0;z-index:9000;display:flex;justify-content:flex-end;background:rgba(40,48,66,.16);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}
      .ab-panel{width:min(560px,100%);height:100%;overflow-y:auto;padding:24px clamp(16px,4vw,26px) 36px;color:#3f4a63;font:400 14px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Segoe UI",sans-serif;border-left:1px solid rgba(255,255,255,.9);box-shadow:-24px 0 60px rgba(90,100,130,.16);background:linear-gradient(165deg,rgba(255,255,255,.86),rgba(255,255,255,.66)),radial-gradient(60% 40% at 100% 0%,#e6ddff 0%,rgba(230,221,255,0) 70%),radial-gradient(50% 40% at 0% 100%,#d9f6e9 0%,rgba(217,246,233,0) 70%);backdrop-filter:blur(30px) saturate(160%);-webkit-backdrop-filter:blur(30px) saturate(160%)}
      .ab-panel *{box-sizing:border-box}
      .ab-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 4px}
      .ab-title strong{font-size:20px;font-weight:600;letter-spacing:.02em}
      .ab-sub{margin:0;font-size:12px;color:#98a1b3;word-break:break-all}
      .ab-overall{display:inline-flex;align-items:center;gap:6px;margin-top:10px;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:500;background:rgba(255,255,255,.8);border:1px solid rgba(255,255,255,.9);box-shadow:0 6px 16px rgba(120,132,160,.10)}
      .ab-overall i{width:7px;height:7px;border-radius:50%;background:#b9c2d2;font-style:normal}
      .ab-overall.is-on{color:#2f7a58}
      .ab-overall.is-on i{background:#8fe3c0;box-shadow:0 0 0 3px rgba(143,227,192,.25)}
      .ab-card{margin-top:14px;padding:16px 18px;border-radius:22px;border:1px solid rgba(255,255,255,.9);background:rgba(255,255,255,.6);box-shadow:0 14px 36px rgba(120,132,160,.10);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
      .ab-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
      .ab-name{font-size:15px;font-weight:600}
      .ab-right{display:flex;align-items:center;gap:10px}
      .ab-chip{display:inline-flex;align-items:center;padding:4px 11px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap}
      .ab-chip.is-ready{background:linear-gradient(135deg,#d8f7e8,#c6f0dd);color:#2f7a58}
      .ab-chip.is-off{background:#eef1f6;color:#7d8698}
      .ab-chip.is-bad{background:linear-gradient(135deg,#ffe4e4,#ffd6da);color:#b45860}
      .ab-switch{position:relative;width:46px;height:26px;padding:0;flex:none;border:0;border-radius:999px;cursor:pointer;background:#e4e8f0;box-shadow:inset 0 1px 2px rgba(80,90,120,.12);transition:background .22s ease}
      .ab-switch::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(90,100,130,.22);transition:transform .22s cubic-bezier(.34,1.4,.64,1)}
      .ab-switch[aria-checked="true"]{background:linear-gradient(135deg,#8fe3c0,#79d7b1)}
      .ab-switch[aria-checked="true"]::after{transform:translateX(20px)}
      .ab-switch:focus-visible{outline:2px solid #a9c9ff;outline-offset:2px}
      .ab-summary{margin:10px 0 0;font-size:12.5px;color:#6b7488}
      .ab-label{display:block;margin:16px 0 6px;font-size:12px;color:#98a1b3;letter-spacing:.02em}
      .ab-input{width:100%;min-width:0;padding:10px 13px;font:inherit;color:#3f4a63;background:rgba(255,255,255,.78);border:1px solid rgba(196,208,226,.55);border-radius:16px;outline:none;transition:border-color .18s ease,box-shadow .18s ease}
      .ab-input::placeholder{color:#b3bbc9}
      .ab-input:focus{border-color:#b9d4f6;box-shadow:0 0 0 4px rgba(185,212,246,.28)}
      .ab-hint{margin:8px 0 0;font-size:11.5px;line-height:1.55;color:#98a1b3;word-break:break-all}
      .ab-actions{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:14px}
      .ab-btn{padding:8px 16px;font:inherit;font-size:13px;color:#55607a;cursor:pointer;background:rgba(255,255,255,.8);border:1px solid rgba(196,208,226,.55);border-radius:999px;transition:transform .16s ease,box-shadow .16s ease,background .16s ease}
      .ab-btn:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(120,132,160,.16)}
      .ab-btn:active{transform:translateY(0)}
      .ab-btn:disabled{opacity:.55;cursor:default;transform:none;box-shadow:none}
      .ab-btn.is-primary{color:#3c4a66;border-color:transparent;background:linear-gradient(135deg,#cfe8ff,#e2d9ff);box-shadow:0 8px 22px rgba(150,170,220,.22)}
      .ab-btn.is-ghost{background:transparent;border-color:transparent;color:#98a1b3}
      .ab-btn.is-ghost:hover{color:#6b7488;background:rgba(255,255,255,.5)}
      .ab-status{font-size:12px;color:#98a1b3}
      .ab-port-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:10px;align-items:center}
      .ab-port-row .ab-btn{margin-top:0}
      @media (max-width:620px){
        .ab-panel{width:100%;border-left:0}
        .ab-head{flex-wrap:wrap}
        .ab-right{width:100%;justify-content:space-between}
        .ab-port-row{grid-template-columns:1fr 1fr}
        .ab-port-row .ab-input{grid-column:1 / -1}
      }
      @media (prefers-reduced-motion:reduce){.ab-panel *{transition:none!important}}
    `

    const ensureStyles = () => {
      if (document.getElementById('ab-styles')) return
      const style = document.createElement('style')
      style.id = 'ab-styles'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    function AgentCard({ agent, onSave, busy }) {
      const detected = agent.detection?.path || ''
      const automatic = agent.command === ''
      const [path, setPath] = useState(agent.command || detected)
      const [saved, setSaved] = useState('')
      useEffect(() => { setPath(agent.command || detected) }, [agent.command, detected])

      const usable = agent.enabled && agent.detection.available
      const tone = agent.detection.available ? (usable ? 'is-ready' : 'is-off') : 'is-bad'
      const status = agent.detection.available ? (usable ? '可以使用' : '已关闭') : '不可用'
      const summary = agent.detection.available
        ? usable
          ? `已开启，模型可以用 ask_${agent.id} 把任务派给它。`
          : `已检测到 ${agent.detection.version || 'CLI'}，但开关关着，模型暂时用不了。`
        : `没有找到可用的 CLI：${agent.detection.reason || '未知原因'}。在下面填绝对路径可以手动指定。`

      return h('section', { className: 'ab-card' },
        h('div', { className: 'ab-head' },
          h('span', { className: 'ab-name' }, agent.label),
          h('div', { className: 'ab-right' },
            h('span', { className: `ab-chip ${tone}` }, status),
            h('button', {
              className: 'ab-switch',
              role: 'switch',
              'aria-checked': String(agent.enabled),
              'aria-label': `${agent.label} 开关`,
              title: agent.enabled ? '点击关闭' : '点击开启',
              disabled: busy,
              onClick: () => onSave({ enabled: !agent.enabled }),
            }))),
        h('p', { className: 'ab-summary' }, summary),
        h('label', { className: 'ab-label' }, automatic ? 'CLI 路径（自动探测）' : 'CLI 路径（手动指定）'),
        h('input', {
          className: 'ab-input', value: path, placeholder: agent.effectiveCommand,
          onChange: (event) => setPath(event.target.value),
        }),
        h('p', { className: 'ab-hint' }, automatic
          ? '留空即自动探测，每次启动重新解析；保存会把当前路径固定下来。'
          : '当前使用固定路径；清空并保存可恢复自动探测。'),
        h('p', { className: 'ab-hint' }, `ACP 适配器：${agent.adapterPackage}`),
        h('div', { className: 'ab-actions' },
          h('button', {
            className: 'ab-btn is-primary', disabled: busy,
            onClick: async () => {
              await onSave({ command: path })
              setSaved('已保存')
              setTimeout(() => setSaved(''), 1600)
            },
          }, '保存'),
          automatic ? null : h('button', {
            className: 'ab-btn is-ghost', disabled: busy,
            onClick: async () => {
              await onSave({ command: '' })
              setSaved('已恢复自动')
              setTimeout(() => setSaved(''), 1600)
            },
          }, '恢复自动'),
          saved ? h('span', { className: 'ab-status', role: 'status' }, saved) : null),
      )
    }

    function PortCard({ port, onApplied, busy, setBusy }) {
      const [value, setValue] = useState(String(port))
      const [status, setStatus] = useState('')
      useEffect(() => { setValue(String(port)) }, [port])

      return h('section', { className: 'ab-card' },
        h('div', { className: 'ab-head' },
          h('span', { className: 'ab-name' }, '服务端口'),
          h('span', { className: 'ab-chip is-off' }, `当前 ${port}`)),
        h('p', { className: 'ab-summary' }, '面板和独立页面都从这个端口读取配置。换端口会就地重启服务，不需要重启应用。'),
        h('label', { className: 'ab-label' }, '端口（1–65535）'),
        h('div', { className: 'ab-port-row' },
          h('input', { className: 'ab-input', value, inputMode: 'numeric', onChange: (event) => setValue(event.target.value) }),
          h('button', {
            className: 'ab-btn', disabled: busy,
            onClick: async () => {
              setBusy(true)
              try {
                const result = await call(`/api/port?port=${encodeURIComponent(value)}`)
                setStatus(result.current ? `端口 ${result.port} 是当前端口` : result.free ? `端口 ${result.port} 空闲` : `端口 ${result.port} 已被占用`)
              } catch (error) {
                setStatus(error.message)
              } finally {
                setBusy(false)
              }
            },
          }, '检测'),
          h('button', {
            className: 'ab-btn is-primary', disabled: busy,
            onClick: async () => {
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
                setStatus(`已切换：${BASE}`)
              } catch (error) {
                setStatus(error.message)
              } finally {
                setBusy(false)
              }
            },
          }, '确定')),
        status ? h('p', { className: 'ab-hint' }, status) : null)
    }

    function Panel({ onClose }) {
      const [state, setState] = useState(null)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
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

      const ready = state ? state.agents.filter(agent => agent.enabled && agent.detection.available) : []

      return h('div', {
        className: 'ab-overlay',
        onClick: (event) => { if (event.target === event.currentTarget) onClose() },
      },
        h('div', { className: 'ab-panel' },
          h('div', { className: 'ab-title' },
            h('strong', null, '外部 Agent 桥'),
            h('button', { className: 'ab-btn is-ghost', style: { marginTop: 0 }, onClick: onClose }, '关闭')),
          h('p', { className: 'ab-sub' }, state ? `配置：${state.configPath}` : '加载中…'),
          state ? h('div', { className: `ab-overall ${ready.length > 0 ? 'is-on' : ''}` },
            h('i'),
            h('span', null, ready.length > 0
              ? `已启用 ${ready.length} 个：${ready.map(agent => `ask_${agent.id}`).join('、')}`
              : '当前没有启用的 Agent，模型无法派遣任务。')) : null,
          error ? h('p', { className: 'ab-hint', style: { color: '#b45860' } }, error) : null,
          state ? h(PortCard, {
            port: state.port, busy, setBusy,
            onApplied: (next) => setState(next),
          }) : null,
          ...(state ? state.agents.map((agent) => h(AgentCard, {
            key: agent.id, agent, busy,
            onSave: (patch) => save(agent.id, patch),
          })) : []),
          h('div', { className: 'ab-actions' },
            h('button', {
              className: 'ab-btn', disabled: busy,
              onClick: async () => {
                setBusy(true)
                setNotice('探测中…')
                try {
                  setState(await call('/api/probe', { method: 'POST' }))
                  setNotice(`已重新探测 · ${new Date().toLocaleTimeString()}`)
                  setError('')
                } catch (failure) {
                  setError(failure.message)
                  setNotice('')
                } finally {
                  setBusy(false)
                }
              },
            }, busy ? '探测中…' : '全部重新探测'),
            notice ? h('span', { className: 'ab-status', role: 'status' }, notice) : null),
        ))
    }

    function AgentBridgeSidebar(props) {
      const [open, setOpen] = useState(false)
      useEffect(() => { ensureStyles() }, [])
      return h(React.Fragment, null,
        h('button', { className: 'ab-row', title: '外部 Agent 桥', onClick: () => setOpen(true) },
          h('span', { className: 'ab-dot' }),
          props.wide === false ? null : h('span', null, '外部 Agent')),
        open ? h(Panel, { onClose: () => setOpen(false) }) : null,
      )
    }

    function apply(ctx) {
      ensureStyles()
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'agent-bridge',
        order: -20,
      }, AgentBridgeSidebar))
    }

    return { apply, inject: ['slots'] }
  },
})
