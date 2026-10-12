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
  menuAttached: false, menuBuilding: false
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
  if (state.status !== null) runUi(function () { state.status.setText(String(s)); });
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
    if (state.currencyManager === null) { status('Open the game home screen first'); return; }
    const cs = getState(state.currencyManager, ptr(0));
    if (cs.isNull()) { status('Currency state is not loaded'); return; }
    const str = Memory.allocUtf8String(id);
    const account = getAccount(cs, stringNew(str), ptr(0));
    if (account.isNull()) { status('Currency account ' + id + ' is unavailable'); return; }
    const balance = account.add(T.fields.currencyBalance);
    const old = balance.readS32();
    balance.writeS32(value);
    balanceEvent(state.currencyManager, account, old, ptr(0));
    writeChanges(state.currencyManager, 1, ptr(0));
    status(id + ' set to ' + value);
  }

  state.setCurrency = function (id, value) { queue(function () { setCurrency(id, value); }); };
  state.unlockLocal = function () {
    queue(function () {
      if (state.characterManager === null) { status('Open the game home screen first'); return; }
      for (let type = 1; type <= 5; type++) unlockCharacter(state.characterManager, type, ptr(0));
      unlockEverySkin(state.characterManager, ptr(0));
      status('Local hero and outfit unlock methods completed');
    });
  };
  state.stockGadgets = function () {
    queue(function () {
      ['jet-bike', 'laser-ship', 'supersonic-board', 'headstart-boost'].forEach(function (id) {
        setCurrency(id, 9999);
      });
      status('Local gadget and head-start balances set');
    });
  };
  state.reviveNow = function () {
    queue(function () {
      if (!state.infiniteRevives || state.saveMeState === null) {
        status('Revive is available on the crash screen when enabled'); return;
      }
      saveMeHandled(state.saveMeState, 1, 0, 0, ptr(0));
      status('Revived without spending currency');
    });
  };

  ['HDCurrencyManager.get_HDCurrencyState', 'HDCurrencyManager.get_CoinBalance',
    'HDCurrencyManager.get_GemsBalance', 'HDCurrencyManager.get_TokensBalance'].forEach(function (name) {
    Interceptor.attach(addr(name), { onEnter(args) { state.currencyManager = ptr(args[0]); } });
  });
  Interceptor.attach(addr('CharacterManager.Init'), {
    onEnter(args) { state.characterManager = ptr(args[0]); }
  });
  Interceptor.attach(addr('RunnerStateData.Reset'), {
    onEnter(args) { this.data = ptr(args[0]); },
    onLeave() {
      state.runData = this.data;
      this.data.add(T.fields.runnerMultiplier).writeS64(state.multiplier);
    }
  });
  // Do not dereference PrepareDataForRun's return register. Its return type
  // is not verified by the RVA extractor; a void/scalar return would turn x0
  // into a bogus object pointer. RunnerStateData.Reset captures the real object.

  Interceptor.attach(addr('RunnerManager.EndRun'), {
    onEnter() { state.runData = null; }
  });
  Interceptor.attach(addr('BannerAdManager.set_BannerEnabled'), {
    onEnter(args) {
      state.bannerManager = ptr(args[0]);
      if (state.noAds) args[1] = ptr(0);
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
    onEnter() {
      if (state.pending.length === 0) return;
      const work = state.pending.splice(0, 1)[0];
      try { work(); } catch (e) { status('Action failed: ' + e); }
    }
  });
  state.updateAds = function () {
    if (state.noAds && state.bannerManager !== null)
      queue(function () { setBanner(state.bannerManager, 0, ptr(0)); });
  };
  state.installed = true;
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
function makeText(label, size) {
  const v = Java.use('android.widget.TextView').$new(state.activity);
  v.setText(String(label)); v.setTextColor(-1); v.setTextSize(size || 14);
  v.setPadding(dp(8), dp(6), dp(8), dp(6));
  return v;
}
function makeButton(label, callback) {
  const v = Java.use('android.widget.Button').$new(state.activity);
  v.setText(String(label)); v.setAllCaps(false); addClick(v, callback); return v;
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
      const Frame = Java.use('android.widget.FrameLayout');
      const Scroll = Java.use('android.widget.ScrollView');
      const Gravity = Java.use('android.view.Gravity');
      const View = Java.use('android.view.View');
      const root = Linear.$new(activity); root.setOrientation(1);
      root.setBackgroundColor(-0x11eae4d7); root.setElevation(dp(9));
      const header = makeButton('HD  ▾', function () {
        body.setVisibility(body.getVisibility() === 0 ? 8 : 0);
      });
      root.addView(header);
      const body = Linear.$new(activity); body.setOrientation(1); root.addView(body);
      const tabScroll = Java.use('android.widget.HorizontalScrollView').$new(activity);
      body.addView(tabScroll);
      const tabs = Linear.$new(activity); tabs.setOrientation(0); tabScroll.addView(tabs);
      const scroll = Scroll.$new(activity); body.addView(scroll);
      const content = Linear.$new(activity); content.setOrientation(1); scroll.addView(content);
      const info = makeText('Ready', 12); body.addView(info); state.status = info;
      const lp = Frame.LayoutParams.$new(dp(310), -2); lp.gravity.value = Gravity.TOP.value | Gravity.LEFT.value;
      const decor = activity.getWindow().getDecorView();
      // The decor root is not guaranteed to be a FrameLayout on every device.
      const ViewGroup = Java.use('android.view.ViewGroup');
      const container = Java.cast(decor, ViewGroup);
      container.addView(root, lp);
      root.setX(dp(12)); root.setY(dp(60));
      root.setVisibility(View.VISIBLE.value);
      root.bringToFront();

      const Touch = Java.registerClass({
        name: 'com.outfit7.herodash.mod.Drag' + (++state.uiCount),
        implements: [Java.use('android.view.View$OnTouchListener')],
        fields: { lastX: 'float', lastY: 'float' },
        methods: { onTouch: function (_v, event) {
          const action = event.getActionMasked();
          if (action === 0) { this.lastX.value = event.getRawX(); this.lastY.value = event.getRawY(); return true; }
          if (action === 2) {
            root.setX(Math.max(0, root.getX() + event.getRawX() - this.lastX.value));
            root.setY(Math.max(0, root.getY() + event.getRawY() - this.lastY.value));
            this.lastX.value = event.getRawX(); this.lastY.value = event.getRawY(); return true;
          }
          return action === 1;
        } }
      });
      const grip = makeText('Drag here', 12); grip.setOnTouchListener(Touch.$new()); body.addView(grip, 0);

      function clear() { content.removeAllViews(); }
      function toggle(label, key, after) {
        const sw = Java.use('android.widget.Switch').$new(activity);
        sw.setText(label); sw.setTextColor(-1); sw.setChecked(!!state[key]);
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
        edit.setInputType(2); edit.setSingleLine(true); edit.setTextColor(-1);
        edit.setHint('0 to 2,000,000,000'); content.addView(edit);
        content.addView(makeButton('Set ' + label, function () {
          const value = Number(String(edit.getText().toString()));
          if (!Number.isInteger(value) || value < 0 || value > 2000000000) {
            status('Enter a whole number from 0 to 2,000,000,000'); return;
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
                state.multiplier = progress + 1; label.setText(state.multiplier + '×');
                saveConfig();
                if (state.runData !== null) queue(function () {
                  state.runData.add(T.fields.runnerMultiplier).writeS64(state.multiplier);
                });
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
      state.menuAttached = true;
      state.menuBuilding = false;
      log('Floating menu attached: ' + root.getWidth() + 'px, visibility=' + root.getVisibility());
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
    const menuTimer = setInterval(function () {
      if (state.menuAttached) {
        clearInterval(menuTimer);
        return;
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
