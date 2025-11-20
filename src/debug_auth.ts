
import { createHmac } from 'node:crypto';
import { config } from './config';

const initData = 'query_id=AAHng2sVAAAAAOeDaxXCAXXC&user=%7B%22id%22%3A359367655%2C%22first_name%22%3A%22Kirill%22%2C%22last_name%22%3A%22%22%2C%22username%22%3A%22kirill_zhaborovskiy%22%2C%22language_code%22%3A%22en%22%2C%22is_premium%22%3Atrue%2C%22allows_write_to_pm%22%3Atrue%2C%22photo_url%22%3A%22https%3A%5C%2F%5C%2Ft.me%5C%2Fi%5C%2Fuserpic%5C%2F320%5C%2FkzKbeoGC5bAVcMJs-zdaBIvVV5KN4zmWTagBYzXzjAI.svg%22%7D&auth_date=1763599120&signature=TVmrc-MOlpC8diBggOCC-dI0yKjTGDQaxn8lBElHFVYceOtEzF48H_tn6q5M4dQozEsnToICinYZgzPUwrNNDg&hash=b4d80f117d8f71e8bc8d0817e27cd207cf0d6df98847d98c3560afba8ef4bb7a';

console.log('--- Debugging Telegram Auth ---');
console.log('Bot Token (first 5):', config.botToken.substring(0, 5));
console.log('Bot Token Length:', config.botToken.length);

function validateStandard(initData: string) {
  console.log('\n--- Standard URLSearchParams Validation ---');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  
  params.delete('hash');
  params.delete('signature');
  
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
    
  console.log('Data Check String:');
  console.log(dataCheckString);
  
  const secretKey = createHmac('sha256', 'WebAppData').update(config.botToken.trim()).digest();
  const calculatedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  
  console.log(`Hash: ${hash}`);
  console.log(`Calc: ${calculatedHash}`);
  console.log(`Match: ${hash === calculatedHash}`);
}

function validateManual(initData: string) {
  console.log('\n--- Manual Parsing Validation (Raw Values) ---');
  const params: Record<string, string> = {};
  let hash = '';
  
  initData.split('&').forEach(param => {
    const equalIndex = param.indexOf('=');
    if (equalIndex === -1) return;
    
    const key = param.substring(0, equalIndex);
    const value = param.substring(equalIndex + 1);
    
    if (key === 'hash') {
      hash = value;
    } else if (key !== 'signature') {
      params[key] = value; // Keeping raw encoded value
    }
  });
  
  const dataCheckString = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('\n');
    
  console.log('Data Check String:');
  console.log(dataCheckString);
  
  const secretKey = createHmac('sha256', 'WebAppData').update(config.botToken.trim()).digest();
  const calculatedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  
  console.log(`Hash: ${hash}`);
  console.log(`Calc: ${calculatedHash}`);
  console.log(`Match: ${hash === calculatedHash}`);
}

validateStandard(initData);
validateManual(initData);
