import { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { IconButton } from '../ui';
import AuthField from './AuthField';

export default function PasswordField({ label, hint, ...fieldProps }) {
  const [visible, setVisible] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  function trackCapsLock(event) {
    if (typeof event.getModifierState === 'function') {
      setCapsLockOn(event.getModifierState('CapsLock'));
    }
  }

  return (
    <AuthField
      {...fieldProps}
      label={label}
      icon={Lock}
      type={visible ? 'text' : 'password'}
      onKeyDown={trackCapsLock}
      onKeyUp={trackCapsLock}
      hint={capsLockOn ? 'Caps Lock is on.' : hint}
      trailing={
        <span className="absolute right-1 top-1/2 -translate-y-1/2">
          <IconButton
            type="button"
            icon={visible ? EyeOff : Eye}
            label={visible ? 'Hide password' : 'Show password'}
            size="sm"
            onClick={() => setVisible((current) => !current)}
          />
        </span>
      }
    />
  );
}
