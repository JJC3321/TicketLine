// top_up.rs: deficit includes pending; once per epoch; credit cap; illiquid pool;
// no-deficit. Invariant 5: at most one top-up per epoch; debt <= credit_limit.
mod common;
use common::*;

fn setup_enrolled(
    lamports: u64,
    pending: u64,
) -> (LiteSVM, Keypair, Keypair, Keypair, Pubkey, Pubkey) {
    let mut s = svm();
    let admin = funded(&mut s, 10_000_000_000);
    let oracle = funded(&mut s, 1_000_000_000);
    init_pool(&mut s, &admin, oracle.pubkey());
    let lender = funded(&mut s, 100_000_000_000);
    deposit(&mut s, &lender, 30_000_000_000);
    let node = funded(&mut s, 1_000_000_000);
    let keeper = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    let (auth, _) = auth_pda(&vote);
    let mut cfg = vote_cfg(vote, node.pubkey(), auth, lamports);
    cfg.pending = pending;
    put_vote_account(&mut s, &cfg);
    enroll(&mut s, &node, &vote, Pubkey::new_unique()).unwrap();
    (s, node, keeper, oracle, vote, lender.pubkey())
}

#[test]
fn top_up_covers_deficit_and_accounts_fee() {
    let required = RENT_3762 + 0 + TICKET + BUFFER;
    let have = required - 500_000_000; // 0.5 SOL deficit
    let (mut s, _n, keeper, _o, vote, _l) = setup_enrolled(have, 0);
    top_up(&mut s, &keeper, &vote).unwrap();

    assert_eq!(vote_lamports(&s, &vote), required);
    let pos = position_state(&s, &vote);
    assert_eq!(pos.principal, 500_000_000);
    assert_eq!(pos.fees, 7_500_000); // 1.5% of 0.5 SOL
    assert_eq!(pos.topups, 1);
    assert_eq!(pos.last_topup_epoch, 0);
    let p = pool_state(&s);
    assert_eq!(p.total_principal, 500_000_000);
    assert_eq!(p.total_fees_outstanding, 7_500_000);
    assert_eq!(p.total_topups, 1);
}

#[test]
fn top_up_includes_pending_rewards_in_required() {
    let pending = 500_000_000u64;
    let required = RENT_3762 + pending + TICKET + BUFFER;
    let have = required - 700_000_000; // 0.7 SOL deficit incl. pending
    let (mut s, _n, keeper, _o, vote, _l) = setup_enrolled(have, pending);
    top_up(&mut s, &keeper, &vote).unwrap();
    assert_eq!(vote_lamports(&s, &vote), required);
    assert_eq!(position_state(&s, &vote).principal, 700_000_000);
}

#[test]
fn second_top_up_same_epoch_rejected_next_epoch_allowed() {
    let (mut s, _n, keeper, _o, vote, _l) = setup_enrolled(RENT_3762 + 100, 0);
    top_up(&mut s, &keeper, &vote).unwrap();
    let r = top_up(&mut s, &keeper, &vote);
    assert!(r.is_err(), "second top-up same epoch must fail");
    set_epoch(&mut s, 1);
    // still deficit? balance was topped to required; drain ticket to simulate burn
    burn_ticket(&mut s, &vote, TICKET);
    top_up(&mut s, &keeper, &vote).unwrap();
    assert_eq!(position_state(&s, &vote).topups, 2);
}

#[test]
fn top_up_credit_cap_enforced() {
    let (mut s, _n, keeper, oracle, vote, _l) = setup_enrolled(RENT_3762 + 100, 0);
    // shrink credit below needed deficit
    set_credit_limit(&mut s, &oracle, &vote, 100_000_000).unwrap();
    let r = top_up(&mut s, &keeper, &vote);
    assert!(r.is_err(), "deficit above credit limit must fail");
    // restore and it works
    set_credit_limit(&mut s, &oracle, &vote, 10_000_000_000).unwrap();
    top_up(&mut s, &keeper, &vote).unwrap();
}

#[test]
fn set_credit_limit_oracle_only() {
    let (mut s, _n, _k, _o, vote, _l) = setup_enrolled(RENT_3762 + 100, 0);
    let stranger = funded(&mut s, 1_000_000_000);
    let r = set_credit_limit(&mut s, &stranger, &vote, 1);
    assert!(r.is_err(), "non-oracle set_credit_limit must fail");
}

#[test]
fn top_up_rejected_when_pool_illiquid() {
    let mut s = svm();
    let admin = funded(&mut s, 10_000_000_000);
    init_pool(&mut s, &admin, Pubkey::new_unique());
    // only 1 SOL liquidity but ~0.9 SOL deficit needed
    let lender = funded(&mut s, 100_000_000_000);
    deposit(&mut s, &lender, 500_000_000);
    let node = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    let (auth, _) = auth_pda(&vote);
    put_vote_account(&mut s, &vote_cfg(vote, node.pubkey(), auth, RENT_3762 + 1));
    enroll(&mut s, &node, &vote, Pubkey::new_unique()).unwrap();
    let r = top_up(&mut s, &lender, &vote);
    assert!(r.is_err(), "deficit > vault_available must fail PoolIlliquid");
}

#[test]
fn top_up_rejected_when_no_deficit() {
    let required = RENT_3762 + TICKET + BUFFER + 1;
    let (mut s, _n, keeper, _o, vote, _l) = setup_enrolled(required, 0);
    let r = top_up(&mut s, &keeper, &vote);
    assert!(r.is_err(), "no-deficit top-up must fail");
}
