<#import "footer.ftl" as loginFooter>
<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html class="${properties.kcHtmlClass!}" lang="${lang}"<#if realm.internationalizationEnabled> dir="${(locale.rtl)?then('rtl','ltr')}"</#if>>

<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="robots" content="noindex, nofollow">

    <#if properties.meta?has_content>
        <#list properties.meta?split(' ') as meta>
            <meta name="${meta?split('==')[0]}" content="${meta?split('==')[1]}"/>
        </#list>
    </#if>
    <title>${title!msg("loginTitle",(realm.displayName!''))}</title>
    <link rel="icon" href="data:,">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Exo+2:wght@200;300;400&amp;family=Share+Tech+Mono&amp;family=IBM+Plex+Sans+KR:wght@300;400&amp;display=swap" rel="stylesheet">
    <style>
        :root{--bg:#1a2026;--ink:#d9e1e7;--line:#5d6b76;--faint:#46525c;--sub:#93a2ad;--accent:#4cc3e6;--err:#ff7a6b;--ok:#a9e36b;--warn:#ffb454}
        *{box-sizing:border-box}
        html.hud-html,html.hud-html body{margin:0;background:var(--bg)}
        body.hud-body{margin:0;min-height:100vh;font-family:'Exo 2','IBM Plex Sans KR',sans-serif;font-weight:300;color:var(--ink);-webkit-text-size-adjust:100%}
        a{color:var(--accent);text-decoration:none}
        a:hover,a:focus-visible{text-decoration:underline}
        .hud-mono{font-family:'Share Tech Mono',monospace}
        .hud-login{position:relative;min-height:100vh;display:flex;align-items:center;justify-content:center;gap:96px;padding:88px 40px}
        .hud-corner{position:absolute;width:28px;height:28px;border:0 solid var(--line)}
        .hud-corner.tl{left:32px;top:32px;border-left-width:1px;border-top-width:1px}
        .hud-corner.tr{right:32px;top:32px;border-right-width:1px;border-top-width:1px}
        .hud-corner.bl{left:32px;bottom:32px;border-left-width:1px;border-bottom-width:1px}
        .hud-corner.br{right:32px;bottom:32px;border-right-width:1px;border-bottom-width:1px}
        .hud-tag{position:absolute;font-family:'Share Tech Mono',monospace;font-size:12px;letter-spacing:3px;color:var(--sub)}
        .hud-tag.tl{left:72px;top:38px}
        .hud-tag.br{right:72px;bottom:38px}
        .hud-reticle{position:relative;width:420px;height:420px;flex:none;display:flex;align-items:center;justify-content:center}
        .hud-reticle .ring{position:absolute;inset:0;width:100%;height:100%}
        .hud-reticle .logo{position:relative;width:28.571%;height:auto}
        .hud-panel{width:400px;max-width:100%;display:flex;flex-direction:column;gap:22px}
        .hud-head{display:flex;flex-direction:column;gap:6px}
        .hud-eyebrow{font-family:'Share Tech Mono',monospace;font-size:12px;letter-spacing:3px;color:var(--accent)}
        .hud-title{margin:0;font-size:44px;font-weight:200;letter-spacing:6px;line-height:1.15}
        .hud-rule{height:1px;background:var(--line)}
        .hud-subtitle{margin:0;font-family:'Share Tech Mono',monospace;font-size:13px;font-weight:400;letter-spacing:2px;color:var(--sub);text-transform:uppercase}
        .hud-subtitle:empty{display:none}
        .hud-body-area{display:flex;flex-direction:column;gap:22px}
        .hud-panel .hud-msg{margin:0;font-family:'Share Tech Mono',monospace;font-size:13px;letter-spacing:1.5px;line-height:1.5;color:var(--accent);border-left:2px solid currentColor;padding:2px 0 2px 10px;overflow-wrap:anywhere}
        .hud-panel .hud-msg-error,.hud-panel .hud-msg.error{color:var(--err)}
        .hud-panel .hud-msg-success{color:var(--ok)}
        .hud-panel .hud-msg-warning{color:var(--warn)}
        .hud-panel .hud-msg-info{color:var(--accent)}
        .hud-alert{display:contents}
        .hud-panel .hud-msg a{text-decoration:underline}
        .hud-btn,button.hud-btn,input.hud-btn,a.hud-btn{display:flex;align-items:center;justify-content:center;gap:12px;min-height:46px;padding:0 32px;border:1px solid var(--ink);background:transparent;color:var(--ink);font:400 14px 'Exo 2','IBM Plex Sans KR',sans-serif;letter-spacing:4px;cursor:pointer;text-decoration:none;border-radius:0;-webkit-appearance:none;appearance:none}
        .hud-btn:hover,.hud-btn:focus-visible{border-color:var(--accent);color:var(--accent);outline:none;text-decoration:none}
        .hud-btn-primary,input.hud-btn-primary,button.hud-btn-primary{background:var(--ink);color:var(--bg)}
        .hud-btn-primary:hover,.hud-btn-primary:focus-visible{background:var(--accent);border-color:var(--accent);color:var(--bg)}
        .hud-btn-block{width:100%}
        .hud-btn-lg{min-height:46px}
        .hud-social,.hud-panel ul.hud-social{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
        .hud-social-btn{height:52px;font-size:15px;letter-spacing:3px;padding:0 16px;width:100%}
        .hud-social-btn svg{flex:none}
        .hud-social-btn.disabled,.hud-social-btn[aria-disabled=true]{opacity:.5;pointer-events:none}
        .hud-field,.hud-form-group{display:flex;flex-direction:column;gap:4px;margin:0}
        .hud-form-group+.hud-form-group{margin-top:18px}
        .hud-field label,label.hud-label,.hud-label{font-family:'Share Tech Mono',monospace;font-size:12px;letter-spacing:2px;color:var(--sub);text-transform:uppercase}
        .hud-panel input:not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]):not([type=hidden]),.hud-panel select,.hud-panel textarea{width:100%;height:40px;border:0;border-bottom:1px solid var(--line);border-radius:0;background:transparent;font:300 17px 'Exo 2','IBM Plex Sans KR',sans-serif;color:var(--ink);padding:0;outline:none}
        .hud-panel textarea{height:auto;min-height:80px;border:1px solid var(--line);padding:6px}
        .hud-panel select option{background:var(--bg)}
        .hud-panel input:focus,.hud-panel select:focus,.hud-panel textarea:focus{border-bottom-color:var(--accent)}
        .hud-panel input[aria-invalid=true]{border-bottom-color:var(--err)}
        .hud-panel input:-webkit-autofill{-webkit-text-fill-color:var(--ink);-webkit-box-shadow:0 0 0 40px var(--bg) inset;caret-color:var(--ink)}
        .hud-panel input[type=checkbox],.hud-panel input[type=radio]{accent-color:var(--accent);margin-right:8px}
        .hud-input-group{display:flex;align-items:flex-end;gap:8px}
        .hud-input-group input{flex:1;min-width:0}
        .hud-eye-btn{flex:none;height:40px;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--sub);cursor:pointer;font:12px 'Share Tech Mono',monospace;letter-spacing:2px;padding:0 4px}
        .hud-eye-btn:hover{color:var(--accent)}
        .hud-eye::before{content:"SHOW"}
        .hud-eye-hide::before{content:"HIDE"}
        .hud-actions{display:flex;justify-content:flex-end;align-items:center;margin-top:4px}
        .hud-options{display:flex;justify-content:space-between;align-items:center;font-family:'Share Tech Mono',monospace;font-size:12px;letter-spacing:2px;color:var(--sub)}
        .hud-settings,.hud-form-options-wrapper{display:flex;justify-content:space-between;gap:12px;font-size:13px;color:var(--sub)}
        .hud-panel p,.hud-panel .instruction{margin:0 0 12px;font-size:15px;line-height:1.6;color:var(--ink)}
        .hud-panel hr{border:0;height:1px;background:var(--faint);margin:0}
        .hud-panel ul,.hud-panel ol{padding-left:20px;margin:0 0 12px}
        .hud-panel table{width:100%;border-collapse:collapse;font-size:14px}
        .hud-panel td,.hud-panel th{border-bottom:1px solid var(--faint);padding:6px 4px;text-align:left}
        .hud-panel code,.hud-panel pre{font-family:'Share Tech Mono',monospace;color:var(--accent);white-space:pre-wrap;overflow-wrap:anywhere}
        .hud-panel form{margin:0}
        .hud-form-buttons,#kc-form-buttons{margin-top:22px}
        .hud-panel #kc-info{margin-top:4px}
        .hud-panel #kc-info-wrapper,.hud-panel #kc-registration{font-size:14px;color:var(--sub)}
        #kc-attempted-username{font-family:'Share Tech Mono',monospace;letter-spacing:2px;color:var(--ink)}
        #kc-username{display:flex;align-items:center;gap:12px;margin:0}
        #reset-login{font-family:'Share Tech Mono',monospace;font-size:12px;letter-spacing:2px}
        .hud-locale{position:absolute;right:72px;top:34px;z-index:2}
        .hud-locale-main{position:relative}
        #kc-current-locale-link{background:transparent;border:0;color:var(--sub);font:12px 'Share Tech Mono',monospace;letter-spacing:3px;cursor:pointer;text-transform:uppercase}
        #kc-current-locale-link:hover{color:var(--accent)}
        .hud-locale-list{display:none;position:absolute;right:0;top:100%;margin:4px 0 0;padding:6px 0;list-style:none;background:var(--bg);border:1px solid var(--line);min-width:120px}
        #kc-current-locale-link[aria-expanded=true]+.hud-locale-list{display:block}
        .hud-locale-item{display:block;padding:6px 14px;font-size:14px;color:var(--ink)}
        .hud-sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
        .hud-panel .pf-c-tile,.hud-panel .select-auth-box-parent{border:1px solid var(--line);padding:10px 12px;margin-bottom:10px}
        @media (max-width:960px){
            .hud-login{flex-direction:column;gap:28px;padding:76px 24px 72px}
            .hud-reticle{width:min(240px,62vw);height:min(240px,62vw)}
            .hud-panel{width:100%;max-width:400px}
            .hud-title{font-size:34px;letter-spacing:4px}
            .hud-corner.tl,.hud-corner.bl{left:12px}
            .hud-corner.tr,.hud-corner.br{right:12px}
            .hud-corner.tl,.hud-corner.tr{top:12px}
            .hud-corner.bl,.hud-corner.br{bottom:12px}
            .hud-tag{font-size:10px;letter-spacing:2px}
            .hud-tag.tl{left:48px;top:18px}
            .hud-tag.br{right:48px;bottom:18px}
            .hud-locale{right:48px;top:14px}
        }
        @media (max-width:400px){
            .hud-login{padding-left:20px;padding-right:20px}
            .hud-title{font-size:28px;letter-spacing:3px}
            .hud-reticle{width:min(200px,56vw);height:min(200px,56vw)}
        }
    </style>
    <script type="importmap">
        {
            "imports": {
                "rfc4648": "${url.resourcesCommonPath}/vendor/rfc4648/rfc4648.js"
            }
        }
    </script>
    <script src="${url.resourcesPath}/js/menu-button-links.js" type="module"></script>
    <#if scripts??>
        <#list scripts as script>
            <script src="${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="module">
        import { startSessionPolling } from "${url.resourcesPath}/js/authChecker.js";

        startSessionPolling(
            "${url.ssoLoginInOtherTabsUrl?js_string?no_esc}"
        );
    </script>
    <script type="module">
        document.addEventListener("click", (event) => {
            const link = event.target.closest("a[data-once-link]");

            if (!link) {
                return;
            }

            if (link.getAttribute("aria-disabled") === "true") {
                event.preventDefault();
                return;
            }

            const { disabledClass } = link.dataset;

            if (disabledClass) {
                link.classList.add(...disabledClass.trim().split(/\s+/));
            }

            link.setAttribute("role", "link");
            link.setAttribute("aria-disabled", "true");
        });
    </script>
    <#if authenticationSession??>
        <script type="module">
            import { checkAuthSession } from "${url.resourcesPath}/js/authChecker.js";

            <#-- 26.3.3 passes the hash as a string, 26.7 as a number -->
            <#assign hudHash = authenticationSession.authSessionIdHash>
            checkAuthSession(
                <#if hudHash?is_string>"${hudHash?js_string?no_esc}"<#else>${hudHash?c}</#if>
            );
        </script>
    </#if>
</head>

<body class="hud-body ${properties.kcBodyClass!}" data-page-id="login-${pageId}">
<div class="${properties.kcLoginClass!}">
    <span class="hud-corner tl" aria-hidden="true"></span>
    <span class="hud-corner tr" aria-hidden="true"></span>
    <span class="hud-corner bl" aria-hidden="true"></span>
    <span class="hud-corner br" aria-hidden="true"></span>
    <span class="hud-tag tl" aria-hidden="true">HUB-01 / MAKGOL / AUTH</span>
    <span class="hud-tag br" aria-hidden="true">SIGNAL &middot; NOMINAL</span>

    <#if realm.internationalizationEnabled && locale.supported?size gt 1>
        <div class="${properties.kcLocaleMainClass!}" id="kc-locale">
            <div id="kc-locale-wrapper" class="${properties.kcLocaleWrapperClass!}">
                <div id="kc-locale-dropdown" class="menu-button-links ${properties.kcLocaleDropDownClass!}">
                    <button tabindex="1" id="kc-current-locale-link" aria-label="${msg("languages")}" aria-haspopup="true" aria-expanded="false" aria-controls="language-switch1">${locale.current}</button>
                    <ul role="menu" tabindex="-1" aria-labelledby="kc-current-locale-link" aria-activedescendant="" id="language-switch1" class="${properties.kcLocaleListClass!}">
                        <#assign i = 1>
                        <#list locale.supported as l>
                            <li class="${properties.kcLocaleListItemClass!}" role="none">
                                <a role="menuitem" id="language-${i}" class="${properties.kcLocaleItemClass!}" href="${l.url}">${l.label}</a>
                            </li>
                            <#assign i++>
                        </#list>
                    </ul>
                </div>
            </div>
        </div>
    </#if>

    <div class="hud-reticle" aria-hidden="true">
        <svg class="ring" viewBox="0 0 420 420" fill="none" aria-hidden="true">
            <circle cx="210" cy="210" r="200" stroke="#46525c" stroke-width="1"></circle>
            <circle cx="210" cy="210" r="160" stroke="#4cc3e6" stroke-width="1.5" stroke-dasharray="4 10"></circle>
            <circle cx="210" cy="210" r="118" stroke="#46525c" stroke-width="1"></circle>
            <path d="M210 0v30M210 390v30M0 210h30M390 210h30" stroke="#93a2ad" stroke-width="1"></path>
            <path d="M68 68l14 14M352 68l-14 14M68 352l14-14M352 352l-14-14" stroke="#46525c" stroke-width="1"></path>
            <path d="M210 50a160 160 0 0 1 138 80" stroke="#4cc3e6" stroke-width="3"></path>
        </svg>
        <svg class="logo" viewBox="0 0 144 144" role="img" aria-label="makgol.com"><path fill="#d9e1e7" fill-rule="evenodd" clip-rule="evenodd" d="M75 5.71L126.55 35.5A6 6 0 0 1 129.55 40.69L129.55 40.69L129.55 100.25A6 6 0 0 1 126.55 105.45L126.55 105.45L75 135.23A6 6 0 0 1 69 135.23L69 135.23L17.45 105.45A6 6 0 0 1 14.45 100.25L14.45 100.25L14.45 40.690A6 6 0 0 1 17.45 35.5L17.45 35.5L69 5.71A6 6 0 0 1 75 5.71ZM67.53 29.36L68.57 31.46A5.41 5.41 0 1 1 75.43 31.46L76.47 29.36C77.93 32.69 80.31 36.81 89.32 42.01C98.32 47.21 103.08 47.21 106.69 46.81L106.69 46.81L105.39 48.76A5.41 5.41 0 1 1 108.83 54.7L111.16 54.55C109.01 57.48 106.63 61.6 106.63 72C106.63 82.4 109.01 86.52 111.16 89.45L111.16 89.45L108.83 89.3A5.41 5.41 0 1 1 105.39 95.24L106.69 97.19C103.08 96.79 98.32 96.79 89.32 101.99C80.31 107.19 77.93 111.31 76.47 114.64L76.47 114.64L75.43 112.54A5.41 5.41 0 1 1 68.57 112.54L67.53 114.64C66.07 111.31 63.69 107.19 54.68 101.99C45.68 96.79 40.92 96.79 37.31 97.19L37.31 97.19L38.61 95.24A5.41 5.41 0 1 1 35.17 89.3L32.84 89.45C34.99 86.52 37.37 82.4 37.37 72C37.37 61.6 34.99 57.48 32.84 54.55L32.84 54.55L35.17 54.7A5.41 5.41 0 1 1 38.61 48.76L37.31 46.81C40.92 47.21 45.68 47.21 54.68 42.01C63.69 36.81 66.07 32.69 67.53 29.36ZM75.22 53.71L75.22 47.22Q75.22 43.9 78.5 44.47A28.29 28.29 0 0 1 92.59 52.6Q94.73 55.16 91.84 56.82L86.23 60.06Q84.25 61.2 82.62 59.6A16.33 16.33 0 0 0 77.43 56.6Q75.22 55.99 75.22 53.71ZM89.46 65.64L95.07 62.4Q97.95 60.74 99.09 63.86A28.29 28.29 0 0 1 99.09 80.14Q97.95 83.26 95.07 81.6L89.46 78.36Q87.47 77.21 88.05 75A16.33 16.33 0 0 0 88.05 69Q87.47 66.79 89.46 65.64ZM86.23 83.94L91.84 87.18Q94.73 88.84 92.59 91.4A28.29 28.29 0 0 1 78.5 99.53Q75.22 100.1 75.22 96.78L75.22 90.29Q75.22 88.01 77.43 87.4A16.33 16.33 0 0 0 82.62 84.4Q84.25 82.8 86.23 83.94ZM68.78 90.29L68.78 96.78Q68.78 100.1 65.5 99.53A28.29 28.29 0 0 1 51.41 91.4Q49.27 88.84 52.16 87.18L57.77 83.94Q59.75 82.8 61.38 84.4A16.33 16.33 0 0 0 66.57 87.4Q68.78 88.01 68.78 90.29ZM54.54 78.36L48.93 81.6Q46.05 83.26 44.91 80.14A28.29 28.29 0 0 1 44.91 63.86Q46.05 60.74 48.93 62.4L54.54 65.64Q56.53 66.79 55.95 69A16.33 16.33 0 0 0 55.95 75Q56.53 77.21 54.54 78.36ZM57.77 60.06L52.16 56.82Q49.27 55.16 51.41 52.6A28.29 28.29 0 0 1 65.5 44.47Q68.78 43.9 68.78 47.22L68.78 53.71Q68.78 55.99 66.57 56.6A16.33 16.33 0 0 0 61.38 59.6Q59.75 61.2 57.77 60.06ZM68.67 72a3.33 3.33 0 1 0 6.66 0a3.33 3.33 0 1 0 -6.66 0Z"></path></svg>
    </div>

    <main class="hud-panel ${properties.kcFormCardClass!}">
        <header class="hud-head ${properties.kcFormHeaderClass!}">
            <span class="hud-eyebrow">IDENTITY REQUIRED</span>
            <#assign hudHeader><#nested "header"></#assign>
            <h1 class="hud-title" id="kc-page-title-brand">MAKGOL SPACE</h1>
            <div class="hud-rule"></div>
            <#if !(auth?has_content && auth.showUsername() && !auth.showResetCredentials())>
                <#if displayRequiredFields>
                    <span class="hud-label"><span class="required">*</span> ${msg("requiredFields")}</span>
                </#if>
                <#if hudHeader?markup_string?trim?has_content><h2 class="hud-subtitle" id="kc-page-title">${hudHeader}</h2></#if>
            <#else>
                <#nested "show-username">
                <div id="kc-username" class="${properties.kcFormGroupClass!}">
                    <label id="kc-attempted-username">${auth.attemptedUsername}</label>
                    <a id="reset-login" href="${url.loginRestartFlowUrl}" aria-label="${msg("restartLoginTooltip")}">&#8634; ${msg("restartLoginTooltip")}</a>
                </div>
            </#if>
        </header>
        <div id="kc-content" class="hud-body-area">
          <div id="kc-content-wrapper" class="hud-body-area">

          <#-- App-initiated actions should not see warning messages about the need to complete the action -->
          <#-- during login.                                                                               -->
          <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
              <div class="${properties.kcAlertClass!} alert-${message.type}">
                  <p class="hud-msg hud-msg-${message.type}" role="alert" aria-live="polite"><span class="hud-sr-only">${message.type}: </span>${kcSanitize(message.summary)?no_esc}</p>
              </div>
          </#if>

          <#nested "form">

          <#if auth?has_content && auth.showTryAnotherWayLink()>
              <form id="kc-select-try-another-way-form" action="${url.loginAction}" method="post">
                  <div class="${properties.kcFormGroupClass!}">
                      <input type="hidden" name="tryAnotherWay" value="on"/>
                      <a href="#" id="try-another-way"
                         onclick="document.forms['kc-select-try-another-way-form'].requestSubmit();return false;">${msg("doTryAnotherWay")}</a>
                  </div>
              </form>
          </#if>

          <#if switchOrganizationEnabled?? && switchOrganizationEnabled>
              <form id="kc-switch-organization-form" action="${url.loginAction}" method="post">
                  <div class="${properties.kcFormGroupClass!}">
                      <input type="hidden" name="switchOrganization" value="true"/>
                      <a href="#" id="switch-organization"
                         onclick="document.forms['kc-switch-organization-form'].requestSubmit();return false;">${msg("doSwitchOrganization")}</a>
                  </div>
              </form>
          </#if>

          <#nested "socialProviders">

          <#if displayInfo>
              <div id="kc-info" class="${properties.kcSignUpClass!}">
                  <div id="kc-info-wrapper" class="${properties.kcInfoAreaWrapperClass!}">
                      <#nested "info">
                  </div>
              </div>
          </#if>
          </div>
        </div>

        <@loginFooter.content/>
    </main>
</div>
</body>
</html>
</#macro>
