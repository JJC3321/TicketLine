// exit.rs: blocked while debt > 0; after full repay withdrawer restored,
// position closed. Invariants 1 & 3.
mod common;
use common::*;

#[test]
fn exit_blocked_with_debt_then_restores_withdrawer() {
    let mut s = svm();
    let admin = funded(&mut s, 10_000_000_000);
    init_pool(&mut s, &admin, Pubkey::new_unique());
    let lender = funded(&mut s, 100_000_000_000);
    deposit(&mut s, &lender, 30_000_000_000);
    let node = funded(&mut s, 1_000_000_000);
    let keeper = funded(&mut s, 1_000_000_000);
    let vote = Pubkey::new_unique();
    let (auth, _) = auth_pda(&vote);
    let original_withdrawer = Pubkey::new_unique();
    put_vote_account(&mut s, &vote_cfg(vote, node.pubkey(), auth, RENT_3762 + 100));
    enroll(&mut s, &node, &vote, Pubkey::new_unique()).unwrap();
    top_up(&mut s, &keeper, &vote).unwrap();

    // debt outstanding -> exit must fail
    let r = exit_ix(&mut s, &node, &vote, original_withdrawer);
    assert!(r.is_err(), "exit with debt must fail");

    // repay fully via sweep
    let pos = position_state(&s, &vote);
    credit_commission(&mut s, &vote, pos.principal + pos.fees);
    sweep(&mut s, &keeper, &vote).unwrap();

    // non-owner cannot exit
    let stranger = funded(&mut s, 1_000_000_000);
    let r = exit_ix(&mut s, &stranger, &vote, original_withdrawer);
    assert!(r.is_err(), "non-owner exit must fail");

    exit_ix(&mut s, &node, &vote, original_withdrawer).unwrap();
    // withdrawer restored (verified by re-parsing the account data)
    assert_eq!(vote_withdrawer(&s, &vote), original_withdrawer);
    // position closed
    let (pos_pk, _) = pos_pda(&vote);
    let acct = s.get_account(&pos_pk);
    assert!(acct.is_none() || acct.unwrap().lamports == 0, "position must be closed");
}
