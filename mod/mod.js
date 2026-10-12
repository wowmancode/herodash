/* Talking Tom Hero Dash 26.5.1.12192 local mod.
 * The build script substitutes the version-checked IL2CPP target table below.
 * This is loaded by Frida Gadget inside the app; no root or external overlay
 * permission is used.
 */
const TARGETS = __TARGETS__;
const T = TARGETS[Process.arch];
const state = {
  multiplier: 1, noAds: false, infiniteRevives: false,
  currencyManager: null, characterManager: null, bannerManager: null,
  runData: null, saveMeState: null, pending: [], prefs: null,
  status: null, activity: null, installed: false, uiCount: 0
};

function log(s) {
  console.log('[HeroDashMod] ' + s);
  if (Java.available) Java.perform(function () {
    Java.use('android.util.Log').i('HeroDashMod', String(s));
  });
}
function status(s) {
  log(s);
  if (state.status !== null) runUi(function () { state.status.setText(String(s)); });
}
function addr(name) { return Module.findBaseAddress('libil2cpp.so').add(T.methods[name]); }
function fn(name, ret, args) { return new NativeFunction(addr(name), ret, args); }
function queue(work) { state.pending.push(work); }
function saveConfig() {
  if (state.prefs === null) return;
  state.prefs.edit().putInt('multiplier', state.multiplier)
    .putBoolean('noAds', state.noAds)
    .putBoolean('infiniteRevives', state.infiniteRevives).apply();
}

function installHooks() {
  if (state.installed || !T || Module.findBaseAddress('libil2cpp.so') === null) return;
  state.installed = true;
  const getState = fn('HDCurrencyManager.get_HDCurrencyState', 'pointer', ['pointer', 'pointer']);
  const getAccount = fn('HDCurrencyState.GetHDAccount', 'pointer', ['pointer', 'pointer', 'pointer']);
  const writeChanges = fn('CurrencyManager.WriteChanges', 'int', ['pointer', 'int', 'pointer']);
  const balanceEvent = fn('CurrencyManager.CheckAndFireBalanceChangeEvent', 'void', ['pointer', 'pointer', 'int', 'pointer']);
  const stringNew = new NativeFunction(Module.findExportByName('libil2cpp.so', 'il2cpp_string_new'), 'pointer', ['pointer']);
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
  Interceptor.attach(addr('RunnerManager.PrepareDataForRun'), {
    onLeave(ret) {
      if (!ret.isNull()) {
        state.runData = ptr(ret);
        state.runData.add(T.fields.runnerMultiplier).writeS64(state.multiplier);
      }
    }
  });
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
  log('Native hooks installed for ' + Process.arch);
}

function runUi(action) {
  if (!Java.available || state.activity === null) return;
  Java.perform(function () {
    const Runnable = Java.registerClass({
      name: 'com.outfit7.herodash.mod.R' + (++state.uiCount),
      implements: [Java.use('java.lang.Runnable')],
      methods: { run: action }
    });
    state.activity.runOnUiThread(Runnable.$new());
  });
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
    const Unity = Java.use('com.unity3d.player.UnityPlayer');
    const activity = Unity.currentActivity.value;
    if (activity === null) return;
    state.activity = activity;
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
      const decor = Java.cast(activity.getWindow().getDecorView(), Frame);
      decor.addView(root, lp); root.setX(dp(12)); root.setY(dp(60));

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
      log('Floating menu attached');
    });
  });
}

rpc.exports = {
  init: function () {
    if (!T) { log('Unsupported architecture: ' + Process.arch); return; }
    const timer = setInterval(function () {
      if (Module.findBaseAddress('libil2cpp.so') === null) return;
      clearInterval(timer);
      try { installHooks(); } catch (e) { log('Hook setup failed: ' + e.stack); }
    }, 250);
    const menuTimer = setInterval(function () {
      try {
        if (!Java.available) return;
        Java.perform(function () {
          const Unity = Java.use('com.unity3d.player.UnityPlayer');
          if (Unity.currentActivity.value === null) return;
          clearInterval(menuTimer); buildMenu();
        });
      } catch (e) { log('Menu setup failed: ' + e); }
    }, 500);
  }
};
