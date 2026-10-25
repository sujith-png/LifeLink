/**
 * SMS Provider Gateway Service
 * Integrates real SMS OTP delivery providers supporting Indian mobile numbers:
 * - Twilio (Programmable SMS / Verify)
 * - MSG91 (DLT Compliant Indian SMS Gateway)
 * - Fast2SMS (Indian Developer/Transactional SMS Gateway)
 *
 * Keeps all credentials strictly in backend environment variables (.env).
 * If no SMS provider is configured, throws a clear configuration error instead of pretending SMS was sent.
 */

class SmsService {
  /**
   * Determine the active configured provider
   * @returns {'twilio' | 'msg91' | 'fast2sms' | null}
   */
  static getConfiguredProvider() {
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
      return 'twilio';
    }
    if (process.env.MSG91_AUTH_KEY) {
      return 'msg91';
    }
    if (process.env.FAST2SMS_API_KEY) {
      return 'fast2sms';
    }
    return null;
  }

  /**
   * Check if any SMS provider has been configured
   * @returns {boolean}
   */
  static isConfigured() {
    return this.getConfiguredProvider() !== null;
  }

  /**
   * Send real SMS containing the OTP to the user's mobile number
   * @param {Object} params
   * @param {string} params.phone10 - 10-digit Indian phone (e.g. '9876543210')
   * @param {string} params.phoneE164 - E.164 formatted phone (e.g. '+919876543210')
   * @param {string} params.code - 6-digit OTP code
   * @param {string} params.purpose - Purpose (e.g. 'post_request', 'registration')
   * @returns {Promise<{ success: boolean, provider: string, messageId?: string }>}
   */
  static async sendOtpSms({ phone10, phoneE164, code, purpose = 'post_request' }) {
    const provider = this.getConfiguredProvider();

    // If no provider is configured, check if we're in an automated test environment
    if (!provider) {
      if (process.env.NODE_ENV === 'test' || process.env.ALLOW_TEST_OTP === 'true') {
        return {
          success: true,
          provider: 'test-runner',
          messageId: `test-${Date.now()}`
        };
      }

      // In real development / production: do NOT pretend that an SMS was sent!
      throw new Error(
        'SMS provider is not configured. Please set SMS provider credentials (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN, or MSG91_AUTH_KEY, or FAST2SMS_API_KEY) in your environment variables (.env) to send real OTP SMS to mobile devices.'
      );
    }

    const messageText = `Your LifeLink verification OTP is ${code}. Valid for 5 minutes. Do not share this code with anyone.`;

    if (provider === 'twilio') {
      return await this._sendViaTwilio({ phoneE164, messageText });
    } else if (provider === 'msg91') {
      return await this._sendViaMsg91({ phone10, code });
    } else if (provider === 'fast2sms') {
      return await this._sendViaFast2Sms({ phone10, code, messageText });
    }

    throw new Error(`Unsupported SMS provider: ${provider}`);
  }

  /**
   * Twilio REST API integration
   */
  static async _sendViaTwilio({ phoneE164, messageText }) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const bodyParams = new URLSearchParams({
      To: phoneE164,
      From: fromNumber,
      Body: messageText
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: bodyParams.toString()
    });

    const data = await res.json();
    if (!res.ok) {
      const errDetail = data.message || `Twilio HTTP error ${res.status}`;
      console.error('[SmsService.Twilio] Dispatch failed:', errDetail);
      throw new Error(`Twilio SMS dispatch failed: ${errDetail}`);
    }

    console.log(`[SmsService.Twilio] SMS successfully dispatched to ${phoneE164} (SID: ${data.sid})`);
    return {
      success: true,
      provider: 'twilio',
      messageId: data.sid
    };
  }

  /**
   * MSG91 API integration
   */
  static async _sendViaMsg91({ phone10, code }) {
    const authKey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_TEMPLATE_ID;

    const url = 'https://control.msg91.com/api/v5/otp';
    const payload = {
      template_id: templateId,
      mobile: `91${phone10}`,
      otp: code
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'authkey': authKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || data.type === 'error') {
      const errDetail = data.message || `MSG91 HTTP error ${res.status}`;
      console.error('[SmsService.MSG91] Dispatch failed:', errDetail);
      throw new Error(`MSG91 dispatch failed: ${errDetail}`);
    }

    console.log(`[SmsService.MSG91] SMS OTP successfully dispatched to +91${phone10}`);
    return {
      success: true,
      provider: 'msg91',
      messageId: data.request_id || `msg91-${Date.now()}`
    };
  }

  /**
   * Fast2SMS API integration
   */
  static async _sendViaFast2Sms({ phone10, code, messageText }) {
    const apiKey = process.env.FAST2SMS_API_KEY;
    const url = 'https://www.fast2sms.com/dev/bulkV2';

    const payload = {
      route: 'otp',
      variables_values: code,
      numbers: phone10
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || data.return === false) {
      const errDetail = (data.message && data.message[0]) || `Fast2SMS HTTP error ${res.status}`;
      console.error('[SmsService.Fast2SMS] Dispatch failed:', errDetail);
      throw new Error(`Fast2SMS dispatch failed: ${errDetail}`);
    }

    console.log(`[SmsService.Fast2SMS] SMS OTP successfully dispatched to +91${phone10}`);
    return {
      success: true,
      provider: 'fast2sms',
      messageId: (data.request_id) || `fast2sms-${Date.now()}`
    };
  }
}

module.exports = SmsService;
