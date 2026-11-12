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
      .ab-row{display:flex;align-items:center;gap:7px;width:100%;padding:5px 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12.5px;text-align:left;cursor:pointer;transition:background .16s ease}
      .ab-row:hover{background:rgba(255,255,255,.55)}
      .ab-row .ab-dot{width:7px;height:7px;border-radius:50%;flex:none;background:linear-gradient(135deg,#9be8c8,#7bd3ae);box-shadow:0 0 0 3px rgba(155,232,200,.22)}
      .ab-overlay{position:fixed;inset:0;z-index:9000;display:flex;justify-content:flex-end;background:rgba(40,48,66,.14);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
      .ab-panel{position:relative;display:flex;flex-direction:column;width:min(540px,100%);height:100%;overflow:hidden;color:#3f4a63;font:400 12.5px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Segoe UI",sans-serif;border-left:1px solid rgba(255,255,255,.9);box-shadow:-18px 0 48px rgba(90,100,130,.14);background:linear-gradient(165deg,rgba(255,255,255,.87),rgba(255,255,255,.68)),radial-gradient(60% 40% at 100% 0%,#e6ddff 0%,rgba(230,221,255,0) 70%),radial-gradient(50% 40% at 0% 100%,#d9f6e9 0%,rgba(217,246,233,0) 70%);backdrop-filter:blur(26px) saturate(160%);-webkit-backdrop-filter:blur(26px) saturate(160%)}
      .ab-headbar{flex:none;padding:14px 14px 6px}
      .ab-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 14px 8px;display:grid;grid-template-columns:minmax(0,1fr);gap:8px;align-content:start}
      .ab-foot{flex:none;padding:8px 14px 12px;border-top:1px solid rgba(255,255,255,.7);background:rgba(255,255,255,.5);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
      .ab-panel *{box-sizing:border-box}
      .ab-title{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px}
      .ab-title strong{font-size:15px;font-weight:600;letter-spacing:.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ab-sub{margin:2px 0 0;font-size:10px;color:#5f6b80;overflow-wrap:anywhere}
      .ab-overall{display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:500;background:rgba(255,255,255,.8);border:1px solid rgba(255,255,255,.9);box-shadow:0 4px 12px rgba(120,132,160,.10)}
      .ab-overall i{width:6px;height:6px;border-radius:50%;background:#b9c2d2;font-style:normal}
      .ab-overall.is-on{color:#2f7a58}
      .ab-overall.is-on i{background:#8fe3c0;box-shadow:0 0 0 3px rgba(143,227,192,.25)}
      .ab-card{min-width:0;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.9);background:rgba(255,255,255,.6);box-shadow:0 8px 22px rgba(120,132,160,.09);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
      .ab-head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px}
      .ab-name{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ab-right{display:flex;align-items:center;gap:7px}
      .ab-chip{display:inline-flex;align-items:center;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:600;white-space:nowrap}
      .ab-chip.is-ready{background:linear-gradient(135deg,#d8f7e8,#c6f0dd);color:#2f7a58}
      .ab-chip.is-off{background:#eef1f6;color:#7d8698}
      .ab-chip.is-bad{background:linear-gradient(135deg,#ffe4e4,#ffd6da);color:#b45860}
      .ab-switch{position:relative;width:36px;height:20px;padding:0;flex:none;border:0;border-radius:999px;cursor:pointer;background:#e4e8f0;box-shadow:inset 0 1px 2px rgba(80,90,120,.12);transition:background .22s ease}
      .ab-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(90,100,130,.22);transition:transform .22s cubic-bezier(.34,1.4,.64,1)}
      .ab-switch[aria-checked="true"]{background:linear-gradient(135deg,#8fe3c0,#79d7b1)}
      .ab-switch[aria-checked="true"]::after{transform:translateX(16px)}
      .ab-switch:focus-visible{outline:2px solid #a9c9ff;outline-offset:2px}
      .ab-summary{margin:4px 0 0;font-size:10.5px;color:#6b7488;overflow-wrap:anywhere}
      .ab-label{display:block;margin:8px 0 3px;font-size:10px;color:#5f6b80;letter-spacing:.02em}
      .ab-input{width:100%;min-width:0;padding:6px 9px;font:inherit;font-size:11.5px;color:#2f3a50;background:#fff;border:1px solid rgba(176,192,214,.75);border-radius:9px;outline:none;transition:border-color .18s ease,box-shadow .18s ease}
      .ab-input::placeholder{color:#b3bbc9}
      .ab-input:focus{border-color:#b9d4f6;box-shadow:0 0 0 3px rgba(185,212,246,.26)}
      .ab-hint{margin:4px 0 0;font-size:9.5px;line-height:1.5;color:#5f6b80;overflow-wrap:anywhere}
      .ab-role{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:6px;margin-top:6px}
      .ab-role .ab-label{margin:0}
      .ab-details{margin-top:6px}
      .ab-details summary{cursor:pointer;font-size:9.5px;color:#98a1b3;list-style:none}
      .ab-details summary::-webkit-details-marker{display:none}
      .ab-details summary::before{content:"▸ "}
      .ab-details[open] summary::before{content:"▾ "}
      textarea.ab-input{resize:vertical;min-height:58px;font-family:inherit;line-height:1.5}
      .ab-list{display:grid;gap:6px}
      .ab-item{border:1px solid rgba(255,255,255,.9);border-radius:12px;background:rgba(255,255,255,.6);box-shadow:0 6px 18px rgba(120,132,160,.08);overflow:hidden}
      .ab-item.is-open .ab-row-item{background:rgba(255,255,255,.72);border-bottom:1px solid rgba(176,192,214,.6)}
      .ab-body{padding:9px 10px 10px;display:grid;background:linear-gradient(180deg,#e7f0fb,#f2f7fd)}
      .ab-item.is-open{border-color:rgba(146,174,210,.85);box-shadow:0 10px 24px rgba(84,104,142,.16)}
      .ab-row-item{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;transition:background .14s ease}
      .ab-row-item:hover{background:rgba(255,255,255,.5)}
      .ab-row-name{display:flex;align-items:baseline;gap:7px;min-width:0}
      .ab-row-name strong{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ab-row-tag{font-size:9.5px;color:#5f6b80;white-space:nowrap}
      .ab-chev{font-size:15px;color:#98a1b3;line-height:1}
      .ab-detail-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:8px}
      .ab-detail-head strong{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ab-counter{display:block;text-align:right;font-size:9.5px;color:#98a1b3;margin:2px 0 3px}
      .ab-adapter{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:6px;margin-top:6px}
      .ab-adapter-name{font-size:9.5px;color:#98a1b3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ab-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:7px}
      .ab-btn{padding:4px 10px;font:inherit;font-size:11px;color:#55607a;cursor:pointer;background:rgba(255,255,255,.8);border:1px solid rgba(196,208,226,.55);border-radius:999px;white-space:nowrap;transition:transform .16s ease,box-shadow .16s ease,background .16s ease}
      .ab-btn:hover{transform:translateY(-1px);box-shadow:0 6px 14px rgba(120,132,160,.14)}
      .ab-btn:active{transform:translateY(0)}
      .ab-btn:disabled{opacity:.55;cursor:default;transform:none;box-shadow:none}
      .ab-btn.is-primary{color:#3c4a66;border-color:transparent;background:linear-gradient(135deg,#cfe8ff,#e2d9ff);box-shadow:0 5px 14px rgba(150,170,220,.20)}
      .ab-btn.is-ghost{background:transparent;border-color:transparent;color:#98a1b3}
      .ab-btn.is-ghost:hover{color:#6b7488;background:rgba(255,255,255,.5)}
      .ab-status{font-size:10px;color:#98a1b3}
      .ab-toast{position:absolute;left:50%;bottom:18px;transform:translate(-50%,10px);z-index:60;display:flex;align-items:center;gap:7px;padding:8px 15px;font-size:11.5px;font-weight:600;color:#1f5c3f;background:rgba(255,255,255,.97);border:1px solid rgba(143,227,192,.95);border-radius:999px;box-shadow:0 12px 30px rgba(60,120,95,.24);opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease}
      .ab-toast::before{content:"";width:15px;height:15px;border-radius:50%;flex:none;background:#3fae7c url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.5l3 3 6-6' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/10px no-repeat}
      .ab-toast.is-show{opacity:1;transform:translate(-50%,0)}
      .ab-toast.is-error{color:#8f2f3a;border-color:rgba(255,201,207,.95)}
      .ab-toast.is-error::before{background-color:#cf5b6a}
      .ab-port-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;align-items:center}
      @media (max-width:620px){.ab-panel{width:100%;border-left:0}.ab-port-row{grid-template-columns:minmax(0,1fr) auto auto}}
      @media (prefers-reduced-motion:reduce){.ab-panel *{transition:none!important}}
    `

    const ensureStyles = () => {
      if (document.getElementById('ab-styles')) return
      const style = document.createElement('style')
      style.id = 'ab-styles'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    const statusOf = (agent) => {
      if (!agent.detection.available) return { text: '不可用', cls: 'is-bad' }
      if (!(agent.adapter && agent.adapter.ready)) return { text: '待装适配器', cls: 'is-off' }
      return agent.enabled ? { text: '可以使用', cls: 'is-ready' } : { text: '已关闭', cls: 'is-off' }
    }

    function Switch({ agent, busy, onToggle }) {
      return h('button', {
        className: 'ab-switch',
        role: 'switch',
        'aria-checked': String(agent.enabled),
        'aria-label': `${agent.label} 开关`,
        disabled: busy,
        onClick: (event) => { event.stopPropagation(); onToggle(!agent.enabled) },
      })
    }

    function AgentItem({ agent, open, busy, draft, onDraft, onOpen, onSave, onRefresh }) {
      const detected = agent.detection?.path || ''
      const automatic = agent.command === ''
      const path = draft.command
      const roleTag = draft.tag
      const persona = draft.persona
      const [installing, setInstalling] = useState(false)
      const [adapterNote, setAdapterNote] = useState('')

      const status = statusOf(agent)
      const adapter = agent.adapter || { ready: true }
      const maxChars = agent.personaMaxChars || 2000

      const installAdapter = async () => {
        setInstalling(true)
        setAdapterNote('')
        try {
          await call(`/api/adapters/${agent.id}/install`, { method: 'POST' })
          for (;;) {
            await new Promise(resolve => setTimeout(resolve, 1500))
            const progress = await call(`/api/adapters/${agent.id}`)
            if (progress.install?.status === 'done' || progress.install?.status === 'error') {
              setAdapterNote(progress.install.status === 'error' ? (progress.install.error || '安装失败') : '已安装')
              await onRefresh()
              break
            }
          }
        } catch (error) {
          setAdapterNote(error.message)
        } finally {
          setInstalling(false)
        }
      }

      return h('section', { className: `ab-item${open ? ' is-open' : ''}` },
        h('div', {
          className: 'ab-row-item',
          role: 'button',
          tabIndex: 0,
          onClick: onOpen,
          onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen() } },
        },
          h('div', { className: 'ab-row-name' },
            h('strong', null, agent.label),
            agent.roleLabel ? h('span', { className: 'ab-row-tag' }, agent.cliLabel) : null),
          h('span', { className: `ab-chip ${status.cls}` }, status.text),
          h(Switch, { agent, busy, onToggle: (next) => onSave({ enabled: next }) }),
          h('span', { className: 'ab-chev', 'aria-hidden': 'true' }, open ? '▾' : '▸')),
        open ? h('div', { className: 'ab-body' },
          h('p', { className: 'ab-summary' }, !agent.detection.available
            ? `没有找到可用的 CLI：${agent.detection.reason || '未知原因'}`
            : !adapter.ready
              ? 'CLI 已就绪，但还缺 ACP 适配器，安装后才能启用。'
              : `模型可以用 ask_${agent.id} 把任务派给它。`),
          h('p', { className: 'ab-hint' }, `${agent.cliLabel}${agent.detection.version ? ` · ${agent.detection.version}` : ''} · ${agent.personaPath}`),
          h('label', { className: 'ab-label' }, automatic ? 'CLI 路径（自动探测）' : 'CLI 路径（手动指定）'),
          h('input', {
            className: 'ab-input', value: path, placeholder: agent.effectiveCommand,
            onChange: (event) => onDraft({ command: event.target.value }),
          }),
          h('div', { className: 'ab-adapter' },
            h('span', { className: 'ab-adapter-name' }, `ACP ${String(agent.adapterPackage || '').split('/').pop()} ${adapter.pinned || ''}`.trim()),
            h('span', { className: `ab-chip ${adapter.ready ? 'is-ready' : 'is-off'}` }, adapter.ready
              ? (adapter.source === 'config' ? '自定义' : `已安装 ${adapter.version || ''}`)
              : (installing ? '安装中…' : '未安装')),
            adapter.ready ? null : h('button', { className: 'ab-btn is-primary', disabled: installing, onClick: installAdapter }, installing ? '安装中…' : '安装'),
            adapterNote ? h('span', { className: 'ab-status' }, adapterNote) : null),
          h('div', { className: 'ab-role' },
            h('span', { className: 'ab-label' }, '角色标签'),
            h('input', {
              className: 'ab-input', value: roleTag, maxLength: 10,
              placeholder: agent.cliLabel,
              onChange: (event) => onDraft({ tag: event.target.value }),
            })),
          h('span', { className: 'ab-label' }, '角色设定（派遣时作为前置角色注入）'),
          h('span', { className: 'ab-counter' }, `${persona.length} / ${maxChars}`),
          h('textarea', {
            className: 'ab-input', rows: 5, value: persona, maxLength: maxChars,
            placeholder: '写清楚：你是谁、关注什么、输出格式是什么。',
            onChange: (event) => onDraft({ persona: event.target.value }),
          }),
          h('div', { className: 'ab-actions' },
            h('span', { className: 'ab-status' }, '右上角「保存」提交；保存后下一次派遣立即生效'),
          )) : null)
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
      const [openId, setOpenId] = useState(null)
      const [draft, setDraft] = useState({ id: null, command: '', tag: '', persona: '' })
      const [toast, setToast] = useState(null)
      const [saveState, setSaveState] = useState('')

      const notify = (text, tone) => setToast({ text, tone, at: Date.now() })
      useEffect(() => {
        if (toast === null) return undefined
        const timer = setTimeout(() => setToast(null), 2600)
        return () => clearTimeout(timer)
      }, [toast])
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        try {
          const next = await call('/api/state')
          setState(next)
          setOpenId(current => current === null && next.agents.length > 0 ? next.agents[0].id : current)
          setError('')
        } catch (failure) {
          setError(`连不上本地桥服务（${BASE}）：${failure.message}。宿主的页面服务可能没有启动——检查 DSH 日志，或重新安装插件。`)
        }
      }, [])

      useEffect(() => { void load() }, [load])

      useEffect(() => {
        const agent = state === null ? undefined : state.agents.find(item => item.id === openId)
        if (agent === undefined) {
          setDraft({ id: null, command: '', tag: '', persona: '' })
          return
        }
        setDraft({
          id: agent.id,
          command: agent.command || agent.detection?.path || '',
          tag: agent.roleLabel || '',
          persona: agent.persona || '',
        })
      }, [openId, state])

      const save = async (id, patch) => {
        setBusy(true)
        try {
          setState(await call(`/api/agents/${id}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
          }))
          setError('')
          notify('保存成功，下一次派遣立即生效')
          return true
        } catch (failure) {
          setError(failure.message)
          notify(failure.message, 'error')
          return false
        } finally {
          setBusy(false)
        }
      }

      const ready = state ? state.agents.filter(agent => agent.enabled && agent.detection.available && agent.adapter.ready) : []

      return h('div', {
        className: 'ab-overlay',
        onClick: (event) => { if (event.target === event.currentTarget) onClose() },
      },
        h('div', { className: 'ab-panel' },
          h('div', { className: 'ab-headbar' },
            h('div', { className: 'ab-title' },
              h('strong', null, 'Agent Bridge'),
              h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                saveState ? h('span', { className: 'ab-status' }, saveState) : null,
                h('button', {
                  className: 'ab-btn is-primary',
                  disabled: busy || state === null,
                  onClick: async () => {
                    const agent = state?.agents.find(item => item.id === (draft.id ?? openId ?? state?.agents[0]?.id))
                    if (agent === undefined) return
                    const current = draft.id === agent.id
                      ? draft
                      : { command: agent.command || agent.detection?.path || '', tag: agent.roleLabel || '', persona: agent.persona || '' }
                    const keepAuto = agent.command === '' && current.command === (agent.detection?.path || '')
                    const payload = { command: keepAuto ? '' : current.command, tag: current.tag, persona: current.persona }
                    setSaveState('保存中…')
                    const ok = await save(agent.id, payload)
                    setSaveState(ok ? '已保存' : '保存失败')
                    setTimeout(() => setSaveState(''), 1600)
                  },
                }, '保存'),
                h('button', { className: 'ab-btn is-ghost', onClick: onClose }, '关闭'))),
            h('p', { className: 'ab-sub' }, state ? `配置：${state.configPath}` : '加载中…'),
            state ? h('div', { className: `ab-overall ${ready.length > 0 ? 'is-on' : ''}` },
              h('i'),
              h('span', null, ready.length > 0
                ? `已启用 ${ready.length} 个：${ready.map(agent => `ask_${agent.id}`).join('、')}`
                : '当前没有启用的 Agent，模型无法派遣任务。')) : null),
          h('div', { className: 'ab-body' },
            error ? h('p', { className: 'ab-hint', style: { color: '#b45860' } }, error) : null,
            state === null ? null : [
              h(PortCard, { key: 'port', port: state.port, busy, setBusy, onApplied: (next) => setState(next) }),
              ...state.agents.map((agent) => h(AgentItem, {
                key: agent.id, agent, busy,
                open: openId === agent.id,
                draft: draft.id === agent.id ? draft : { id: agent.id, command: agent.command || agent.detection?.path || '', tag: agent.roleLabel || '', persona: agent.persona || '' },
                onDraft: (patch) => setDraft(current => ({ ...current, ...patch, id: agent.id })),
                onOpen: () => setOpenId(current => current === agent.id ? null : agent.id),
                onSave: (patch) => save(agent.id, patch),
                onRefresh: load,
              })),
            ]),
          h('div', { className: 'ab-foot' },
            h('button', {
              className: 'ab-btn is-primary', disabled: busy,
              onClick: async () => {
                setBusy(true)
                setNotice('探测中…')
                try {
                  setState(await call('/api/probe', { method: 'POST' }))
                  setNotice(`已重新探测 · ${new Date().toLocaleTimeString()}`)
                  notify('重新探测完成')
                  setError('')
                } catch (failure) {
                  setError(failure.message)
                  setNotice('')
                } finally {
                  setBusy(false)
                }
              },
            }, busy ? '探测中…' : '全部重新探测'),
            notice ? h('span', { className: 'ab-status', role: 'status', style: { marginLeft: 10 } }, notice) : null),
          toast === null ? null : h('div', {
            className: `ab-toast is-show${toast.tone === 'error' ? ' is-error' : ''}`,
            role: 'status',
          }, toast.text),
        ))
    }

    function AgentBridgeSidebar(props) {
      const [open, setOpen] = useState(false)
      useEffect(() => { ensureStyles() }, [])
      return h(React.Fragment, null,
        h('button', { className: 'ab-row', title: 'Agent Bridge', onClick: () => setOpen(true) },
          h('span', { className: 'ab-dot' }),
          props.wide === false ? null : h('span', null, 'Agent Bridge')),
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
