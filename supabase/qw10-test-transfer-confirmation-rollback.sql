-- Disable the entry points; preserve correlations, receipts, orders and audit evidence.
drop function public.qw10_test_transfer(text,text,text,bigint);
drop function private.qw10_test_transfer(text,text,text,bigint);
drop function qw10_test.transfer_snapshot(text,text);
