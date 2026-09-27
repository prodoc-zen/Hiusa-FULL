import { toast } from 'sonner';

export function success(message, options) {
  return toast.success(message, options);
}

export function error(message, options) {
  return toast.error(message, options);
}

export function info(message, options) {
  return toast(message, options);
}

export function promise(promiseOrFn, options) {
  return toast.promise(promiseOrFn, options);
}

const notify = { success, error, info, promise };

export default notify;
