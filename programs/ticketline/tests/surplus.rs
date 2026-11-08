// surplus.rs: only when debt == 0; bounded by sweepable; only to payout.
// Invariants 1 & 2 (partial).
mod common;
use common::*;

fn setup_debt_free() -> (LiteSVM, Keypair, Pubkey, Pubkey) {
    let mut s = svm();
    let admin = funded(&mut s, 10_000_000_000);
    init_pool(&mut s, &admin, Pubkey::new_unique());
    let lender = funded(&mut s, 100_000_000_000);
    deposit(&mut s, &lender, 30_000_000_000);
    let node = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    let (auth, _) = auth_pda(&vote);
    let required = RENT_3762 + TICKET + BUFFER;
    put_vote_account(&mut s, &vote_cfg(vote, node.pubkey(), auth, required + 2_000_000_000));
    let payout = Pubkey::new_unique();
    enroll(&mut s, &node, &vote, payout).unwrap();
    (s, node, vote, payout)
}

#[test]
fn surplus_withdraw_to_payout_bounded() {
    let (mut s, node, vote, payout) = setup_debt_free();
    let before = s.get_balance(&payout).unwrap_or(0);
    withdraw_surplus(&mut s, &node, &vote, payout, 1_000_000_000).unwrap();
    assert_eq!(s.get_balance(&payout).unwrap() - before, 1_000_000_000);
    // remaining still >= required
    assert!(vote_lamports(&s, &vote) >= RENT_3762 + TICKET + BUFFER);
    // over the sweepable bound fails
    let r = withdraw_surplus(&mut s, &node, &vote, payout, 2_000_000_000);
    assert!(r.is_err(), "exceeding sweepable must fail");
}

#[test]
fn surplus_rejects_wrong_payout_and_debt() {
    let (mut s, node, vote, payout) = setup_debt_free();
    // wrong payout address -> Unauthorized
    let r = withdraw_surplus(&mut s, &node, &vote, Pubkey::new_unique(), 1);
    assert!(r.is_err());
    let _ = payout;

    // give it debt: drain then top_up
    let keeper = funded(&mut s, 1_000_000_000);
    set_vote_lamports(&mut s, &vote, RENT_3762 + 100);
    top_up(&mut s, &keeper, &vote).unwrap();
    let r = withdraw_surplus(&mut s, &node, &vote, payout, 1);
    assert!(r.is_err(), "withdraw_surplus with debt must fail");
}
