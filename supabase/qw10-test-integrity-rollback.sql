-- Remove only this read-only report; preserve all payment and inventory evidence.
drop function public.qw10_test_integrity();
drop function private.qw10_test_integrity();
