// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/Ownable.sol";

interface ISupportClub {
    struct Subscription {
        address user;
        uint16 amount;
        uint8 amountDecimals;
        uint16 tokenIndex;
        uint8 lastRenewRound;
        bool renewed;
    }

    function subscriptionId(address clubOwner, address user)
        external
        view
        returns (uint256);

    function subscriptionById(address clubOwner, uint256 id)
        external
        view
        returns (Subscription memory);
}

contract SupportClubNFT is Ownable {
    struct TokenData {
        address clubOwner;
        address user;
    }

    mapping(address => uint256) internal _balances;
    mapping(uint256 => TokenData) internal _tokenData;
    // clubOwner => user => tokenId
    mapping(address => mapping(address => uint256)) internal _tokenIds;
    mapping(address => string) internal _clubURI;

    uint256 public totalTokens;
    string public baseURI;

    string public constant name = "Support Club";
    string public constant symbol = "SUPPORT";

    ISupportClub public supportClub;

    error TokenAlreadyExists(uint256 id);
    error NotSubscribed();
    error NotRenewed();
    error Forbidden();
    error TokenNotExists(uint256 id);
    error NotImplemented();

    event Transfer(
        address indexed _from,
        address indexed _to,
        uint256 indexed _tokenId
    );
    event Approval(
        address indexed _owner,
        address indexed _approved,
        uint256 indexed _tokenId
    );
    event ApprovalForAll(
        address indexed _owner,
        address indexed _operator,
        bool _approved
    );
    event SetBaseURI(string indexed baseURI);
    event SetClubBaseURI(address indexed clubOwner, string indexed baseURI_);
    event SetSupportClub(address indexed supportClub);

    constructor(address _supportClub) {
        supportClub = ISupportClub(_supportClub);
    }

    modifier onlyClub() {
        if (msg.sender != address(supportClub)) revert Forbidden();
        _;
    }

    function balanceOf(address owner) external view returns (uint256 balance) {
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId_) external view returns (address owner) {
        address _owner = _tokenData[tokenId_].user;
        if (_owner == address(0)) revert TokenNotExists(tokenId_);
        return _owner;
    }

    function tokenId(address clubOwner, address user)
        external
        view
        returns (uint256)
    {
        uint256 tokenId_ = _tokenIds[clubOwner][user];
        if (tokenId_ == 0) revert TokenNotExists(tokenId_);
        return tokenId_;
    }

    function tokenData(uint256 tokenId_)
        external
        view
        returns (TokenData memory)
    {
        TokenData memory tokenData_ = _tokenData[tokenId_];
        if (tokenData_.user == address(0)) revert TokenNotExists(tokenId_);

        return tokenData_;
    }

    function clubURI(address clubOwner) external view returns (string memory) {
        return _clubURI[clubOwner];
    }

    function tokenURI(uint256 tokenId_) external view returns (string memory) {
        TokenData memory tokenData_ = _tokenData[tokenId_];
        if (tokenData_.user == address(0)) revert TokenNotExists(tokenId_);

        string memory clubURI_ = _clubURI[tokenData_.clubOwner];

        return
            bytes(clubURI_).length > 0
                ? string(abi.encodePacked(clubURI_, tokenId_))
                : string(abi.encodePacked(baseURI, tokenId_));
    }

    function setSupportClub(address _supportClub) external onlyOwner {
        supportClub = ISupportClub(_supportClub);
        emit SetSupportClub(_supportClub);
    }

    function setClubBaseURI(address clubOwner, string memory baseURI_)
        external
    {
        if (msg.sender != clubOwner || msg.sender != owner())
            revert Forbidden();

        _clubURI[clubOwner] = baseURI_;
        emit SetClubBaseURI(clubOwner, baseURI_);
    }

    function mintToken(address clubOwner, address user) external {
        uint256 subscriptionId_ = supportClub.subscriptionId(clubOwner, user);
        if (subscriptionId_ == 0) revert NotSubscribed();
        if (!supportClub.subscriptionById(clubOwner, subscriptionId_).renewed)
            revert NotRenewed();

        uint256 tokenId_ = _tokenIds[clubOwner][user];
        if (tokenId_ != 0) revert TokenAlreadyExists(tokenId_);
        _mintToken(clubOwner, user);
    }

    function burnToken(address clubOwner, address user) external onlyClub {
        _burnToken(clubOwner, user);
    }

    function setBaseURI(string memory baseURI_) external onlyOwner {
        _setBaseURI(baseURI_);
    }

    function safeTransferFrom(
        address,
        address,
        uint256,
        bytes calldata
    ) external payable {
        revert NotImplemented();
    }

    function safeTransferFrom(
        address,
        address,
        uint256
    ) external payable {
        revert NotImplemented();
    }

    function transferFrom(
        address,
        address,
        uint256
    ) external payable {
        revert NotImplemented();
    }

    function approve(address, uint256) external payable {
        revert NotImplemented();
    }

    function setApprovalForAll(address, bool) external {
        revert NotImplemented();
    }

    function getApproved(uint256) external view returns (address) {
        revert NotImplemented();
    }

    function isApprovedForAll(address, address) external view returns (bool) {
        revert NotImplemented();
    }

    function _setBaseURI(string memory baseURI_) internal {
        baseURI = baseURI_;
        emit SetBaseURI(baseURI);
    }

    function _mintToken(address clubOwner, address user) internal {
        uint256 id = ++totalTokens;
        _tokenIds[clubOwner][user] = id;
        _tokenData[id] = TokenData({clubOwner: clubOwner, user: user});
        ++_balances[user];
        emit Transfer(address(0), user, id);
    }

    function _burnToken(address clubOwner, address user) internal {
        uint256 tokenId_ = _tokenIds[clubOwner][user];
        if (tokenId_ != 0) {
            delete _tokenIds[clubOwner][user];
            delete _tokenData[tokenId_];
            _balances[user]--;
            emit Transfer(user, address(0), tokenId_);
        }
    }
}
