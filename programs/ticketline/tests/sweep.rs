// sweep.rs: never dips into reserve (rent+pending+ticket+buffer); fees-first
// allocation; nothing-to-sweep; pool totals. Invariants 1 & 2 (partial).
mod common;
use common::*;

fn setup_with_debt() -> (LiteSVM, Keypair, Keypair, Pubkey) {
    let mut s = svm();
    let admin = funded(&mut s, 10_000_000_000);
    init_pool(&mut s, &admin, Pubkey::new_unique());
    let lender = funded(&mut s, 100_000_000_000);
    deposit(&mut s, &lender, 30_000_000_000);
    let node = funded(&mut s, 1_000_000_000);
    let keeper = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    let (auth, _) = auth_pda(&vote);
    put_vote_account(&mut s, &vote_cfg(vote, node.pubkey(), auth, RENT_3762 + 100));
    enroll(&mut s, &node, &vote, Pubkey::new_unique()).unwrap();
    top_up(&mut s, &keeper, &vote).unwrap();
    (s, node, keeper, vote)
}

#[test]
fn sweep_repays_fees_first_and_respects_reserve() {
    let (mut s, _n, keeper, vote) = setup_with_debt();
    let required = RENT_3762 + TICKET + BUFFER;
    // credit commission: 600_000_000 surplus above required
    credit_commission(&mut s, &vote, 600_000_000);
    let before = vote_lamports(&s, &vote);
    assert_eq!(before, required + 600_000_000);

    let pos_before = position_state(&s, &vote);
    let debt = pos_before.principal + pos_before.fees; // ~0.823 SOL
    sweep(&mut s, &keeper, &vote).unwrap();

    // repay = min(sweepable=0.6, debt) = 0.6 SOL
    let pos = position_state(&s, &vote);
    let repaid = debt - (pos.principal + pos.fees);
    assert_eq!(repaid, 600_000_000);
    // fees-first: fees were ~0.0135 SOL -> fully repaid first
    assert_eq!(pos.fees, 0);
    assert_eq!(pos.principal, debt - 600_000_000);
    // balance never below required
    assert_eq!(vote_lamports(&s, &vote), required);
    // pool totals
    let p = pool_state(&s);
    assert_eq!(p.total_fees_outstanding, 0);
    assert_eq!(p.total_fees_earned, pos_before.fees);
    assert_eq!(p.total_principal, pos.principal);
}

#[test]
fn sweep_full_repay_when_surplus_covers_debt() {
    let (mut s, _n, keeper, vote) = setup_with_debt();
    let pos = position_state(&s, &vote);
    let debt = pos.principal + pos.fees;
    credit_commission(&mut s, &vote, debt + 1_000_000);
    sweep(&mut s, &keeper, &vote).unwrap();
    let pos = position_state(&s, &vote);
    assert_eq!(pos.principal, 0);
    assert_eq!(pos.fees, 0);
    assert_eq!(pos.total_repaid, debt);
    // reserve intact + leftover stays in vote account
    assert_eq!(vote_lamports(&s, &vote), RENT_3762 + TICKET + BUFFER + 1_000_000);
}

#[test]
fn sweep_nothing_to_sweep() {
    let (mut s, _n, keeper, vote) = setup_with_debt();
    // no surplus above required
    let r = sweep(&mut s, &keeper, &vote);
    assert!(r.is_err(), "must fail with NothingToSweep");
}

#[test]
fn sweep_respects_pending_rewards_in_reserve() {
    let mut s = svm();
    let admin = funded(&mut s, 10_000_000_000);
    init_pool(&mut s, &admin, Pubkey::new_unique());
    let lender = funded(&mut s, 100_000_000_000);
    deposit(&mut s, &lender, 30_000_000_000);
    let node = funded(&mut s, 1_000_000_000);
    let keeper = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    let (auth, _) = auth_pda(&vote);
    let mut cfg = vote_cfg(vote, node.pubkey(), auth, RENT_3762 + 100);
    cfg.pending = 2_000_000_000;
    put_vote_account(&mut s, &cfg);
    enroll(&mut s, &node, &vote, Pubkey::new_unique()).unwrap();
    top_up(&mut s, &keeper, &vote).unwrap();

    // required now includes the 2 SOL pending
    let required = RENT_3762 + 2_000_000_000 + TICKET + BUFFER;
    assert_eq!(vote_lamports(&s, &vote), required);
    // credit only 100M surplus; sweep should take exactly that
    credit_commission(&mut s, &vote, 100_000_000);
    sweep(&mut s, &keeper, &vote).unwrap();
    assert_eq!(vote_lamports(&s, &vote), required);
}
