<#import "template.ftl" as layout>
<#import "passkeys.ftl" as passkeys>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>
    <#if section = "header">
        <#-- empty: the HUD title already says what this page is -->
    <#elseif section = "form">
        <#if realm.password && social?? && social.providers?has_content>
            <ul id="kc-social-providers" class="hud-social">
                <#list social.providers as p>
                    <li>
                        <a data-once-link data-disabled-class="disabled" id="social-${p.alias}"
                           class="hud-btn hud-social-btn" href="${p.loginUrl}">
                            <#if p.alias == "google" || p.providerId == "google">
                                <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path></svg>
                                <span>GOOGLE 인증</span>
                            <#else>
                                <span>${p.displayName!}</span>
                            </#if>
                        </a>
                    </li>
                </#list>
            </ul>
        </#if>
        <#if realm.password>
            <form id="kc-form-login" class="hud-body-area" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post">
                <#if !usernameHidden??>
                    <div class="hud-field">
                        <label for="username" class="hud-label">ID</label>
                        <input tabindex="2" id="username" name="username" value="${(login.username!'')}" type="text"
                               autofocus autocomplete="${(enableWebAuthnConditionalUI?has_content)?then('username webauthn', 'username')}"
                               autocapitalize="none" spellcheck="false"
                               aria-invalid="<#if messagesPerField.existsError('username','password')>true<#else>false</#if>"
                               dir="ltr"
                        />
                    </div>
                </#if>

                <div class="hud-field">
                    <label for="password" class="hud-label">PASSWORD</label>
                    <div class="${properties.kcInputGroup!}" dir="ltr">
                        <input tabindex="3" id="password" name="password" type="password" autocomplete="current-password"
                               aria-invalid="<#if messagesPerField.existsError('username','password')>true<#else>false</#if>"
                        />
                        <button class="${properties.kcFormPasswordVisibilityButtonClass!}" type="button" aria-label="${msg("showPassword")}"
                                aria-controls="password" data-password-toggle tabindex="4"
                                data-icon-show="${properties.kcFormPasswordVisibilityIconShow!}" data-icon-hide="${properties.kcFormPasswordVisibilityIconHide!}"
                                data-label-show="${msg('showPassword')}" data-label-hide="${msg('hidePassword')}">
                            <i class="${properties.kcFormPasswordVisibilityIconShow!}" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>

                <#if messagesPerField.existsError('username','password')>
                    <p id="input-error" class="hud-msg hud-msg-error" role="alert" aria-live="polite">${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}</p>
                </#if>

                <#if realm.rememberMe && !usernameHidden??>
                    <div class="hud-options">
                        <label>
                            <input tabindex="5" id="rememberMe" name="rememberMe" type="checkbox"<#if login.rememberMe??> checked</#if>>${msg("rememberMe")}
                        </label>
                    </div>
                </#if>

                <div id="kc-form-buttons" class="hud-actions">
                    <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
                    <input tabindex="7" class="hud-btn hud-btn-primary" name="login" id="kc-login" type="submit" value="ENTER"/>
                </div>
            </form>
        </#if>
        <@passkeys.conditionalUIData />
        <script type="module" src="${url.resourcesPath}/js/passwordVisibility.js"></script>
    <#elseif section = "info" >
        <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
            <div id="kc-registration-container">
                <div id="kc-registration">
                    <span>${msg("noAccount")} <a tabindex="8" href="${url.registrationUrl}">${msg("doRegister")}</a></span>
                </div>
            </div>
        </#if>
    </#if>

</@layout.registrationLayout>
