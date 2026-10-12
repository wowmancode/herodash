/* Talking Tom Hero Dash 26.5.1.12192 local mod.
 * The build script substitutes the version-checked IL2CPP target table below.
 * This is loaded by Frida Gadget inside the app; no root or external overlay
 * permission is used.
 */
import Java from 'frida-java-bridge';

const TARGETS = __TARGETS__;
const T = TARGETS[Process.arch];
const state = {
  multiplier: 1, noAds: false, infiniteRevives: false,
  currencyManager: null, characterManager: null, bannerManager: null,
  runData: null, saveMeState: null, pending: [], prefs: null,
  status: null, activity: null, installed: false, uiCount: 0,
  menuAttached: false, menuBuilding: false, menuBuildStartedAt: 0,
  menuRoot: null, menuHost: null,
  // Android UI can initialize before the IL2CPP hooks become safe to install.
  // Keep the menu operational rather than throwing when these callbacks are
  // referenced during its first render.
  updateAds: function () {},
  setCurrency: function () { status('Game hooks are not ready yet'); },
  unlockLocal: function () { status('Game hooks are not ready yet'); },
  stockGadgets: function () { status('Game hooks are not ready yet'); },
  reviveNow: function () { status('Game hooks are not ready yet'); }
};

// Report logs without touching ART/Java; native logging works before the VM is ready.
let androidLogWrite = null;
function log(s) {
  const message = String(s);
  console.log('[HeroDashMod] ' + message);
  try {
    if (androidLogWrite === null) {
      const liblog = Process.findModuleByName('liblog.so');
      if (liblog === null) return;
      androidLogWrite = new NativeFunction(liblog.getExportByName('__android_log_write'),
                                           'int', ['int', 'pointer', 'pointer']);
    }
    androidLogWrite(4, Memory.allocUtf8String('HeroDashMod'), Memory.allocUtf8String(message));
  } catch (error) {
    console.error('[HeroDashMod] Native logging unavailable: ' + error);
  }
}
function status(s) {
  log(s);
  if (state.status !== null) runUi(function () { setViewText(state.status, s); });
}
function il2cppModule() { return Process.findModuleByName('libil2cpp.so'); }
function addr(name) {
  const module = il2cppModule();
  if (module === null) throw new Error('libil2cpp.so is not loaded');
  if (!Object.prototype.hasOwnProperty.call(T.methods, name))
    throw new Error('Missing IL2CPP method: ' + name);
  return module.base.add(T.methods[name]);
}
function fn(name, ret, args) { return new NativeFunction(addr(name), ret, args); }
function queue(work) { state.pending.push(work); }
function drainQueue() {
  // Drain all pending work; called from multiple IL2CPP hooks to
  // guarantee execution even when HDAdManager.OnLateUpdate is inactive.
  while (state.pending.length > 0) {
    const work = state.pending.shift();
    try { work(); } catch (e) { status('Action failed: ' + e); }
  }
}
function saveConfig() {
  if (state.prefs === null) return;
  state.prefs.edit().putInt('multiplier', state.multiplier)
    .putBoolean('noAds', state.noAds)
    .putBoolean('infiniteRevives', state.infiniteRevives).apply();
}

function installHooks() {
  if (state.installed || !T || il2cppModule() === null) return;
  const getState = fn('HDCurrencyManager.get_HDCurrencyState', 'pointer', ['pointer', 'pointer']);
  const getAccount = fn('HDCurrencyState.GetHDAccount', 'pointer', ['pointer', 'pointer', 'pointer']);
  const writeChanges = fn('CurrencyManager.WriteChanges', 'int', ['pointer', 'int', 'pointer']);
  const balanceEvent = fn('CurrencyManager.CheckAndFireBalanceChangeEvent', 'void', ['pointer', 'pointer', 'int', 'pointer']);
  const stringNew = new NativeFunction(Process.getModuleByName('libil2cpp.so').getExportByName('il2cpp_string_new'), 'pointer', ['pointer']);
  const unlockEverySkin = fn('CharacterManager.UnlockEverySkin', 'void', ['pointer', 'pointer']);
  const unlockCharacter = fn('CharacterManager.FullyUnlockCharacterAndSkins', 'void', ['pointer', 'int', 'pointer']);
  const saveMeHandled = fn('SaveMeState.OnSaveMeHandled', 'void', ['pointer', 'int', 'int', 'int', 'pointer']);
  const trySaveMe = fn('SaveMeState.TryToPurchaseSaveMe', 'void', ['pointer', 'pointer', 'pointer']);
  const setBanner = fn('BannerAdManager.set_BannerEnabled', 'void', ['pointer', 'int', 'pointer']);

  function setCurrency(id, value) {
    log('setCurrency(' + id + ', ' + value + ') mgr=' + state.currencyManager);
    if (state.currencyManager === null) { status('Open the game home screen first'); return; }
    const cs = getState(state.currencyManager, ptr(0));
    log('  currencyState=' + cs);
    if (cs.isNull()) { status('Currency state is not loaded'); return; }
    const str = Memory.allocUtf8String(id);
    const account = getAccount(cs, stringNew(str), ptr(0));
    log('  account(' + id + ')=' + account);
    if (account.isNull()) { status('Currency account ' + id + ' is unavailable'); return; }
    const balance = account.add(T.fields.currencyBalance);
    const old = balance.readS32();
    balance.writeS32(value);
    balanceEvent(state.currencyManager, account, old, ptr(0));
    writeChanges(state.currencyManager, 1, ptr(0));
    status(id + ' set to ' + value);
  }

  // Execute IL2CPP work directly when called from Android UI thread (which is
  // Unity's main thread).  Fall back to queue() only if we need to wait for
  // a manager pointer to be captured by a game hook.
  function tryDirect(work) {
    try { work(); } catch (e) { status('Action failed: ' + e); }
  }
  state.setCurrency = function (id, value) { tryDirect(function () { setCurrency(id, value); }); };
  state.unlockLocal = function () {
    tryDirect(function () {
      if (state.characterManager === null) { status('Open the game home screen first'); return; }
      for (let type = 1; type <= 5; type++) unlockCharacter(state.characterManager, type, ptr(0));
      unlockEverySkin(state.characterManager, ptr(0));
      status('Local hero and outfit unlock methods completed');
    });
  };
  state.stockGadgets = function () {
    tryDirect(function () {
      ['jet-bike', 'laser-ship', 'supersonic-board', 'headstart-boost'].forEach(function (id) {
        setCurrency(id, 9999);
      });
      status('Local gadget and head-start balances set');
    });
  };
  state.reviveNow = function () {
    tryDirect(function () {
      if (!state.infiniteRevives || state.saveMeState === null) {
        status('Revive is available on the crash screen when enabled'); return;
      }
      saveMeHandled(state.saveMeState, 1, 0, 0, ptr(0));
      status('Revived without spending currency');
    });
  };

  ['HDCurrencyManager.get_HDCurrencyState', 'HDCurrencyManager.get_CoinBalance',
    'HDCurrencyManager.get_GemsBalance', 'HDCurrencyManager.get_TokensBalance'].forEach(function (name) {
    Interceptor.attach(addr(name), { onEnter(args) {
      state.currencyManager = ptr(args[0]);
      drainQueue();
    } });
  });
  Interceptor.attach(addr('CharacterManager.Init'), {
    onEnter(args) {
      state.characterManager = ptr(args[0]);
      log('CharacterManager captured');
      drainQueue();
    }
  });
  Interceptor.attach(addr('RunnerStateData.Reset'), {
    onEnter(args) { this.data = ptr(args[0]); },
    onLeave() {
      state.runData = this.data;
      this.data.add(T.fields.runnerMultiplier).writeS64(state.multiplier);
      drainQueue();
    }
  });
  // Do not dereference PrepareDataForRun's return register. Its return type
  // is not verified by the RVA extractor; a void/scalar return would turn x0
  // into a bogus object pointer. RunnerStateData.Reset captures the real object.

  Interceptor.attach(addr('RunnerManager.EndRun'), {
    onEnter() { state.runData = null; drainQueue(); }
  });
  Interceptor.attach(addr('BannerAdManager.set_BannerEnabled'), {
    onEnter(args) {
      state.bannerManager = ptr(args[0]);
      if (state.noAds) args[1] = ptr(0);
      drainQueue();
    }
  });
  Interceptor.attach(addr('InterstitialAdManager.get_AdReady'), {
    onLeave(ret) { if (state.noAds) ret.replace(0); }
  });
  Interceptor.attach(addr('SaveMeState.OnEnter'), {
    onEnter(args) { state.saveMeState = ptr(args[0]); }
  });
  Interceptor.attach(addr('SaveMeState.OnExit'), {
    onEnter(args) {
      if (state.saveMeState !== null && state.saveMeState.equals(args[0])) state.saveMeState = null;
    }
  });
  Interceptor.replace(addr('SaveMeState.TryToPurchaseSaveMe'), new NativeCallback(function (self, clickState, info) {
    if (state.infiniteRevives) saveMeHandled(self, 1, 0, 0, ptr(0));
    else trySaveMe(self, clickState, info);
  }, 'void', ['pointer', 'pointer', 'pointer']));
  Interceptor.attach(addr('HDAdManager.OnLateUpdate'), {
    onEnter() { drainQueue(); }
  });
  state.updateAds = function () {
    if (state.noAds && state.bannerManager !== null) {
      tryDirect(function () { setBanner(state.bannerManager, 0, ptr(0)); });
    }
  };
  // Periodic fallback: drain any straggling queued work every 500ms.
  // Primary execution is now direct, but the queue persists as a safety net
  // for the slider's live multiplier update during a run and similar cases.
  setInterval(function () { drainQueue(); }, 500);
  state.installed = true;
  state.updateAds();
  log('Native hooks installed for ' + Process.arch);
}

function runUi(action) {
  if (!Java.available || state.activity === null) {
    log('Menu UI deferred: Java or activity unavailable');
    state.menuBuilding = false;
    return;
  }
  // Avoid generating a custom Runnable/DEX solely to reach Android's UI
  // thread. Frida Java bridge provides an existing main-thread dispatcher.
  try {
    Java.scheduleOnMainThread(function () {
      try {
        action();
      } catch (e) {
        state.menuBuilding = false;
        log('Menu UI exception: ' + (e.stack || e));
      }
    });
  } catch (e) {
    state.menuBuilding = false;
    log('Menu UI dispatch exception: ' + (e.stack || e));
  }
}
function dp(n) { return Math.round(n * state.activity.getResources().getDisplayMetrics().density.value); }
function addClick(view, action) {
  const C = Java.registerClass({
    name: 'com.outfit7.herodash.mod.C' + (++state.uiCount),
    implements: [Java.use('android.view.View$OnClickListener')],
    methods: { onClick: action }
  });
  view.setOnClickListener(C.$new());
}
// Frida 17's Java bridge cannot reliably choose between setText(int) and
// setText(CharSequence) for a plain JS string. Construct a real Java String
// and select the CharSequence overload explicitly on all Android text widgets.
function javaText(value) {
  return Java.use('java.lang.String').$new(String(value));
}
function setViewText(view, value) {
  view.setText.overload('java.lang.CharSequence').call(view, javaText(value));
}
// Read a TextView/EditText as a plain JS string. getText() returns an
// Editable wrapper whose toString() may not yield a JS string through
// Frida's bridge, so go through String.valueOf(Object) explicitly.
function readViewText(view) {
  const raw = view.getText();
  let s = null;
  try { s = Java.use('java.lang.String').valueOf.overload('java.lang.Object').call(null, raw); } catch (e) {}
  if (typeof s !== 'string') {
    try { s = Java.cast(raw, Java.use('java.lang.Object')).toString(); } catch (e) {}
  }
  if (typeof s !== 'string') s = String(s);
  return s;
}
// Accept "999", " 1,000 ", and non-ASCII digits some keyboards produce.
function parseWholeNumber(text) {
  const cleaned = String(text)
    .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
    .replace(/[０-９]/g, function (d) { return String(d.charCodeAt(0) - 0xFF10); })
    .replace(/[\s,._'  ]/g, '');
  if (!/^\d+$/.test(cleaned)) return NaN;
  return parseInt(cleaned, 10);
}
function setViewHint(view, value) {
  view.setHint.overload('java.lang.CharSequence').call(view, javaText(value));
}
function makeText(label, size) {
  const v = Java.use('android.widget.TextView').$new(state.activity);
  setViewText(v, label); v.setTextColor(-16777216); v.setTextSize(size || 14);
  v.setPadding(dp(8), dp(6), dp(8), dp(6));
  return v;
}
function makeButton(label, callback) {
  const v = Java.use('android.widget.Button').$new(state.activity);
  setViewText(v, label); v.setAllCaps(false); v.setTextColor(-16777216);
  addClick(v, callback); return v;
}
function buildMenu() {
  Java.perform(function () {
    let activity;
    try {
      const Unity = Java.use('com.unity3d.player.UnityPlayer');
      activity = Unity.currentActivity.value;
      if (activity === null) {
        state.menuBuilding = false;
        log('Menu waiting: Unity.currentActivity is null');
        return;
      }
      // Retain across the async main-thread callback.
      activity = Java.retain(activity);
      state.activity = activity;
    } catch (e) {
      state.menuBuilding = false;
      log('Menu activity lookup failed: ' + (e.stack || e));
      return;
    }
    log('Menu activity ready: ' + activity.getClass().getName().toString());
    state.prefs = activity.getSharedPreferences('herodash_mod', 0);
    state.multiplier = Math.max(1, Math.min(1000, state.prefs.getInt('multiplier', 1)));
    state.noAds = state.prefs.getBoolean('noAds', false);
    state.infiniteRevives = state.prefs.getBoolean('infiniteRevives', false);
    runUi(function () {
      const Linear = Java.use('android.widget.LinearLayout');
      // Frida's Java bridge does not expose nested classes as properties
      // (Linear.LayoutParams is undefined), so load them by binary name.
      const LinearParams = Java.use('android.widget.LinearLayout$LayoutParams');
      const FrameParams = Java.use('android.widget.FrameLayout$LayoutParams');
      const Scroll = Java.use('android.widget.ScrollView');
      const Gravity = Java.use('android.view.Gravity');
      const View = Java.use('android.view.View');
      const TextView = Java.use('android.widget.TextView');
      const Color = Java.use('android.graphics.Color');
      const GradientDrawable = Java.use('android.graphics.drawable.GradientDrawable');
      const root = Linear.$new(activity);
      root.setOrientation(1);
      root.setPadding(dp(8), dp(8), dp(8), dp(8));
      root.setBackgroundColor(Color.rgb(242, 242, 245));
      root.setElevation(dp(12));
      const header = makeButton('Hero Dash menu  ✕', function () {
        root.setVisibility(View.GONE.value);
      });
      root.addView(header);
      const body = Linear.$new(activity);
      body.setOrientation(1);
      root.addView(body);
      const tabScroll = Java.use('android.widget.HorizontalScrollView').$new(activity);
      body.addView(tabScroll);
      const tabs = Linear.$new(activity);
      tabs.setOrientation(0);
      tabScroll.addView(tabs);
      const scroll = Scroll.$new(activity);
      body.addView(scroll, LinearParams.$new(-1, dp(340)));
      const content = Linear.$new(activity);
      content.setOrientation(1);
      scroll.addView(content);
      const info = makeText('Ready', 12);
      body.addView(info);
      state.status = info;

      // Like runintogold's TomMenu.install(): place a standalone draggable
      // floating button with Activity.addContentView(), not in the Unity
      // content hierarchy. The actual controls stay hidden until tapped.
      const screen = activity.getResources().getDisplayMetrics();
      const panelLp = FrameParams.$new(
        Math.min(dp(320), screen.widthPixels.value - dp(16)), -2);
      panelLp.gravity.value = Gravity.TOP.value | Gravity.LEFT.value;
      activity.addContentView(root, panelLp);
      root.setX(dp(8));
      root.setY(dp(185));
      root.setVisibility(View.GONE.value);

      const bubble = TextView.$new(activity);
      setViewText(bubble, 'HD');
      bubble.setTextSize(17);
      bubble.setTextColor(Color.rgb(0, 0, 0));
      bubble.setGravity(Gravity.CENTER.value);
      const background = GradientDrawable.$new();
      background.setColor(Color.rgb(245, 166, 35));
      background.setCornerRadius(dp(24));
      bubble.setBackground(background);
      bubble.setElevation(dp(16));
      bubble.setAlpha(0.93);
      const bubbleLp = FrameParams.$new(dp(48), dp(48));
      bubbleLp.gravity.value = Gravity.TOP.value | Gravity.LEFT.value;
      activity.addContentView(bubble, bubbleLp);
      const prefsX = state.prefs.getInt('bubbleX', dp(8));
      const prefsY = state.prefs.getInt('bubbleY', dp(120));
      bubble.setX(Math.max(0, Math.min(prefsX, screen.widthPixels.value - dp(48))));
      bubble.setY(Math.max(0, Math.min(prefsY, screen.heightPixels.value - dp(48))));

      const Drag = Java.registerClass({
        name: 'com.outfit7.herodash.mod.BubbleDrag' + (++state.uiCount),
        implements: [Java.use('android.view.View$OnTouchListener')],
        fields: {
          downX: 'float', downY: 'float',
          startX: 'float', startY: 'float', moved: 'boolean'
        },
        methods: { onTouch: function (v, event) {
          const action = event.getActionMasked();
          if (action === 0) {
            this.downX.value = event.getRawX();
            this.downY.value = event.getRawY();
            this.startX.value = bubble.getX();
            this.startY.value = bubble.getY();
            this.moved.value = false;
            return true;
          }
          if (action === 2) {
            const dx = event.getRawX() - this.downX.value;
            const dy = event.getRawY() - this.downY.value;
            if (Math.abs(dx) > dp(7) || Math.abs(dy) > dp(7)) this.moved.value = true;
            if (this.moved.value) {
              bubble.setX(Math.max(0, Math.min(this.startX.value + dx,
                screen.widthPixels.value - dp(48))));
              bubble.setY(Math.max(0, Math.min(this.startY.value + dy,
                screen.heightPixels.value - dp(48))));
            }
            return true;
          }
          if (action === 1) {
            if (this.moved.value) {
              state.prefs.edit().putInt('bubbleX', Math.round(bubble.getX()))
                .putInt('bubbleY', Math.round(bubble.getY())).apply();
            } else {
              const opening = root.getVisibility() !== View.VISIBLE.value;
              root.setVisibility(opening ? View.VISIBLE.value : View.GONE.value);
              if (opening) root.bringToFront();
              bubble.bringToFront();
              log(opening ? 'Mod menu opened' : 'Mod menu hidden');
            }
            return true;
          }
          return action === 3;
        }}
      });
      bubble.setOnTouchListener(Drag.$new());

      function clear() { content.removeAllViews(); }
      function toggle(label, key, after) {
        const sw = Java.use('android.widget.Switch').$new(activity);
        setViewText(sw, label); sw.setTextColor(-16777216); sw.setChecked(!!state[key]);
        const Listener = Java.registerClass({
          name: 'com.outfit7.herodash.mod.S' + (++state.uiCount),
          implements: [Java.use('android.widget.CompoundButton$OnCheckedChangeListener')],
          methods: { onCheckedChanged: function (_button, checked) {
            state[key] = !!checked; saveConfig(); if (after) after();
          } }
        });
        sw.setOnCheckedChangeListener(Listener.$new()); content.addView(sw);
      }
      function currencyInput(label, id) {
        content.addView(makeText(label));
        const edit = Java.use('android.widget.EditText').$new(activity);
        edit.setInputType(2); edit.setSingleLine(true); edit.setTextColor(-16777216);
        setViewHint(edit, '0 to 2,000,000,000'); content.addView(edit);
        content.addView(makeButton('Set ' + label, function () {
          const text = readViewText(edit);
          const value = parseWholeNumber(text);
          log('Currency input for ' + id + ': raw="' + text + '" parsed=' + value);
          if (!Number.isInteger(value) || value < 0 || value > 2000000000) {
            status('Enter a whole number from 0 to 2,000,000,000 (got "' + text + '")'); return;
          }
          state.setCurrency(id, value);
        }));
      }
      function show(tab) {
        clear();
        if (tab === 'Gameplay') {
          content.addView(makeText('Score multiplier: ' + state.multiplier + '×'));
          const label = makeText(state.multiplier + '×'); content.addView(label);
          const slider = Java.use('android.widget.SeekBar').$new(activity);
          slider.setMax(999); slider.setProgress(state.multiplier - 1);
          const Listener = Java.registerClass({
            name: 'com.outfit7.herodash.mod.Seek' + (++state.uiCount),
            implements: [Java.use('android.widget.SeekBar$OnSeekBarChangeListener')],
            methods: {
              onProgressChanged: function (_v, progress, _user) {
                state.multiplier = progress + 1; setViewText(label, state.multiplier + '×');
                saveConfig();
                if (state.runData !== null) {
                  try { state.runData.add(T.fields.runnerMultiplier).writeS64(state.multiplier); }
                  catch (e) { log('Live multiplier update failed: ' + e); }
                }
              },
              onStartTrackingTouch: function () {}, onStopTrackingTouch: function () {}
            }
          });
          slider.setOnSeekBarChangeListener(Listener.$new()); content.addView(slider);
          toggle('Unlimited local revives', 'infiniteRevives');
          content.addView(makeButton('Revive now (crash screen)', function () { state.reviveNow(); }));
        } else if (tab === 'Currency') {
          currencyInput('Coins', 'coins'); currencyInput('Gems', 'gems');
          currencyInput('Tokens', 'tokens');
          content.addView(makeText('This build has no currency ID named credits.', 12));
        } else if (tab === 'Unlocks') {
          content.addView(makeButton('Unlock local heroes and outfits', function () { state.unlockLocal(); }));
          content.addView(makeButton('Stock local gadgets and head start', function () { state.stockGadgets(); }));
        } else {
          toggle('Hide banners and interstitials', 'noAds', function () { state.updateAds(); });
          content.addView(makeButton('Reset mod settings', function () {
            state.multiplier = 1; state.noAds = false; state.infiniteRevives = false;
            saveConfig(); show('Settings'); status('Mod settings reset');
          }));
        }
      }
      ['Gameplay', 'Currency', 'Unlocks', 'Settings'].forEach(function (tab) {
        const b = makeButton(tab, function () { show(tab); }); b.setTextSize(9); tabs.addView(b);
      });
      show('Gameplay'); state.updateAds();
      if (root.getParent() === null || bubble.getParent() === null)
        throw new Error('Activity.addContentView did not attach menu and button');
      state.menuRoot = Java.retain(bubble);
      state.menuHost = Java.retain(root);
      state.menuAttached = true;
      state.menuBuilding = false;
      log('Floating menu attached: Gold Run style HD button; '
        + 'panel hidden until tapped, bubble visibility=' + bubble.getVisibility());
    });
  });
}

function initializeMod() {
    if (!T) { log('Unsupported architecture: ' + Process.arch); return; }
    // Do not intercept Unity/IL2CPP initialization: early native hooks can
    // execute while the engine is still constructing its managed state.
    // Wait for the menu and then allow the game to finish loading first.
    let nativeTimer = null;
    function scheduleNativeHooks() {
      if (nativeTimer !== null) return;
      nativeTimer = setTimeout(function () {
        const poll = setInterval(function () {
          if (il2cppModule() === null) return;
          clearInterval(poll);
          try { installHooks(); } catch (e) { log('Hook setup failed: ' + e.stack); }
        }, 1000);
      }, 20000);
    }
    // Unity may replace its window content while the loading screen is up.
    // Schedule attachment after the activity settles; retry on recoverable
    // Java/UI errors instead of losing the menu forever after the first try.
    let menuScheduled = false;
    let menuAttempts = 0;
    let nextHealthCheck = 0;
    const menuTimer = setInterval(function () {
      // Unity can replace its content view when switching scenes. Keep the
      // launcher alive by detecting a detached overlay and rebuilding it.
      if (state.menuAttached) {
        if (Date.now() >= nextHealthCheck) {
          nextHealthCheck = Date.now() + 3000;
          try {
            Java.scheduleOnMainThread(function () {
              try {
                if (state.menuRoot !== null &&
                    !state.menuRoot.isAttachedToWindow()) {
                  log('Menu detached from window; requesting reattachment');
                  state.menuAttached = false;
                  state.menuRoot = null;
                  state.menuHost = null;
                  state.status = null;
                }
              } catch (e) {
                log('Menu health check failed: ' + (e.stack || e));
              }
            });
          } catch (e) {
            log('Menu health check dispatch failed: ' + (e.stack || e));
          }
        }
        return;
      }
      if (state.menuBuilding && Date.now() - state.menuBuildStartedAt > 15000) {
        log('Menu build stalled; retrying');
        state.menuBuilding = false;
      }
      if (menuScheduled || state.menuBuilding) return;
      try {
        if (!Java.available) {
          if (++menuAttempts % 12 === 0) log('Menu waiting for Java VM');
          return;
        }
        Java.perform(function () {
          try {
            const Unity = Java.use('com.unity3d.player.UnityPlayer');
            if (Unity.currentActivity.value === null) {
              if (++menuAttempts % 12 === 0) log('Menu waiting for Unity activity');
              return;
            }
            scheduleNativeHooks();
            menuScheduled = true;
            log('Unity activity detected; menu attachment scheduled');
            setTimeout(function () {
              menuScheduled = false;
              if (state.menuAttached || state.menuBuilding) return;
              state.menuBuilding = true;
              state.menuBuildStartedAt = Date.now();
              try {
                buildMenu();
              } catch (e) {
                state.menuBuilding = false;
                log('Menu build failed: ' + (e.stack || e));
              }
            }, 4000);
          } catch (e) {
            log('Menu setup error: ' + (e.stack || e));
          }
        });
      } catch (e) {
        log('Menu polling error: ' + (e.stack || e));
      }
    }, 500);
}

// Gadget script interaction invokes rpc.exports.init() automatically.
rpc.exports = {
  init: function (stage) {
    log('Gadget init stage=' + stage + ' arch=' + Process.arch);
    initializeMod();
  }
};
