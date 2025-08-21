import argparse
import sys
from upstash_redis import Redis
import requests
import concurrent.futures
import time
from tqdm import tqdm
from typing import Tuple, Literal, List, Set

# --- Key Checker Configuration ---
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 2
MAX_WORKERS = 200
API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent"


# Initialize Redis client - this can be shared across all functions
try:
    redis = Redis(url="redis url", token="redis token")
except Exception as e:
    print(f"Failed to connect to Redis: {e}")
    exit(1)

def add_auths():
    """
    Reads secrets from txt/add_auths.txt and adds them to Redis one by one,
    prompting for an expiration period for each key.
    """
    try:
        with open('txt/add_auths.txt', 'r') as f:
            keys = [line.strip() for line in f if line.strip()]

        if not keys:
            print("No keys found in txt/add_auths.txt. Exiting.")
            return

        set_name = "AUTH_SECRET_SET"
        hash_name = "AUTH_SECRET_EXPIRATION_HASH"
        
        successful_additions = 0
        print(f"Found {len(keys)} keys to process in 'txt/add_auths.txt'.")

        for key in keys:
            while True:
                try:
                    days_str = input(f"  -> Enter validity period in days for key '{key}': ")
                    days = int(days_str)
                    if days > 0:
                        break
                    else:
                        print("    [Error] Validity must be a positive integer. Please try again.")
                except ValueError:
                    print("    [Error] Invalid input. Please enter an integer.")
            
            expiration_timestamp = int(time.time()) + (days * 24 * 60 * 60)

            # Execute commands directly
            sadd_result = redis.sadd(set_name, key)
            redis.hset(hash_name, key, str(expiration_timestamp))

            if sadd_result == 1:
                 successful_additions += 1
            print(f"    + Key '{key}' added with a validity of {days} days.")

        print("\n--- Summary ---")
        print(f"Total keys processed: {len(keys)}.")
        print(f"Successfully added {successful_additions} new keys.")
        
        # Clear the file after successful operation
        with open('txt/add_auths.txt', 'w') as f:
            pass
        print("Cleared 'txt/add_auths.txt'.")

    except FileNotFoundError:
        print("Error: txt/add_auths.txt not found.")
    except Exception as e:
        print(f"An error occurred during add_auths: {e}")

def delete_auths():
    """
    Reads secrets from txt/delete_auths.txt and removes them from the AUTH_SECRET_SET.
    """
    try:
        with open('txt/delete_auths.txt', 'r') as f:
            keys_to_delete = [line.strip() for line in f if line.strip()]

        if not keys_to_delete:
            print("No keys found in txt/delete_auths.txt. Exiting.")
            return

        set_name = "AUTH_SECRET_SET"
        successful_deletions = redis.srem(set_name, *keys_to_delete)
        print(f"Successfully removed {successful_deletions} keys from the Redis set '{set_name}'.")
        print(f"Total keys processed for deletion: {len(keys_to_delete)}.")

        # Clear the file after successful operation
        with open('txt/delete_auths.txt', 'w') as f:
            pass
        print("Cleared 'txt/delete_auths.txt'.")

    except FileNotFoundError:
        print("Error: txt/delete_auths.txt not found.")
    except Exception as e:
        print(f"An error occurred during delete_auths: {e}")

def check_expired_auths():
    """
    Checks for and removes expired auth secrets from both the hash and the set.
    """
    try:
        set_name = "AUTH_SECRET_SET"
        hash_name = "AUTH_SECRET_EXPIRATION_HASH"
        current_time = int(time.time())

        all_auths = redis.hgetall(hash_name)
        if not all_auths:
            print(f"No auths found in '{hash_name}' to check.")
            return

        expired_keys = []
        for key, timestamp in all_auths.items():
            try:
                if int(timestamp) < current_time:
                    expired_keys.append(key)
            except ValueError:
                print(f"    [Warning] Invalid timestamp value found for key '{key}': '{timestamp}'. Marking for removal.")
                expired_keys.append(key)

        if not expired_keys:
            print("No expired auth keys found.")
            return

        print(f"Found {len(expired_keys)} expired auth keys. Removing them...")

        # Execute commands directly
        removed_from_set = redis.srem(set_name, *expired_keys)
        removed_from_hash = redis.hdel(hash_name, *expired_keys)

        print(f"Successfully removed {removed_from_set} keys from '{set_name}'.")
        print(f"Successfully removed {removed_from_hash} keys from '{hash_name}'.")

    except Exception as e:
        print(f"An error occurred during check_expired_auths: {e}")

def add_keys():
    """
    Reads keys from txt/add_keys.txt and adds them to the GEMINI_API_KEY_SET.
    """
    try:
        with open('txt/add_keys.txt', 'r') as f:
            keys = [line.strip() for line in f if line.strip()]

        if not keys:
            print("No keys found in txt/add_keys.txt. Exiting.")
            return

        set_name = "GEMINI_API_KEY_SET"
        #set_name = "TRANSLATE_KEY_SET"  # Change to your desired set name
        successful_additions = redis.sadd(set_name, *keys)
        print(f"Successfully added {successful_additions} new keys to the Redis set '{set_name}'.")
        print(f"Total keys processed: {len(keys)}.")

        # Clear the file after successful operation
        with open('txt/add_keys.txt', 'w') as f:
            pass
        print("Cleared 'txt/add_keys.txt'.")

    except FileNotFoundError:
        print("Error: txt/add_keys.txt not found.")
    except Exception as e:
        print(f"An error occurred during add_keys: {e}")

def delete_keys():
    """
    Reads keys from txt/delete_keys.txt and removes them from the GEMINI_API_KEY_SET.
    """
    try:
        with open('txt/delete_keys.txt', 'r') as f:
            keys_to_delete = [line.strip() for line in f if line.strip()]

        if not keys_to_delete:
            print("No keys found in txt/delete_keys.txt. Exiting.")
            return

        set_name = "GEMINI_API_KEY_SET"
        successful_deletions = redis.srem(set_name, *keys_to_delete)
        print(f"Successfully removed {successful_deletions} keys from the Redis set '{set_name}'.")
        print(f"Total keys processed for deletion: {len(keys_to_delete)}.")

        # Clear the file after successful operation
        with open('txt/delete_keys.txt', 'w') as f:
            pass
        print("Cleared 'txt/delete_keys.txt'.")

    except FileNotFoundError:
        print("Error: txt/delete_keys.txt not found.")
    except Exception as e:
        print(f"An error occurred during delete_keys: {e}")


def deduplicate_keys():
    """
    Reads keys from txt/allkeys.txt, removes duplicates, and overwrites the file.
    """
    keys_file = 'txt/allkeys.txt'
    try:
        with open(keys_file, 'r', encoding='utf-8') as f:
            all_keys_list = [line.strip() for line in f if line.strip()]
        
        original_key_count = len(all_keys_list)
        if original_key_count == 0:
            print("No keys found in txt/allkeys.txt.")
            return
            
        unique_keys = sorted(list(set(all_keys_list)))
        unique_key_count = len(unique_keys)

        with open(keys_file, 'w', encoding='utf-8') as f:
            for key in unique_keys:
                f.write(f"{key}\n")

        print("\n" + "="*35)
        print("         Key Deduplication Complete")
        print("="*35)
        print(f"File processed: {keys_file}")
        print(f"Original key count: {original_key_count}")
        print(f"Unique key count:   {unique_key_count}")
        print(f"Removed duplicates: {original_key_count - unique_key_count}")
        print(f"'{keys_file}' has been updated with unique keys.")
        print("="*35)

    except FileNotFoundError:
        print(f"Error: '{keys_file}' not found.")
    except Exception as e:
        print(f"An error occurred during deduplication: {e}")


def _check_key_validity(key: str) -> Tuple[Literal['active', 'invalid'], str]:
    """
    Helper function to check a single API key's validity.
    """
    url_with_key = f"{API_URL}?key={key}"
    payload = {'contents': [{'parts': [{'text': 'hello'}]}]}
    
    for _ in range(MAX_RETRIES):
        try:
            response = requests.post(url_with_key, json=payload, timeout=20)
            if response.status_code in [200, 429]:
                return 'active', key
            if response.status_code in [403,503]:
                return 'invalid', key
        except requests.exceptions.RequestException:
            pass # Errors will lead to retry, and eventually 'invalid'
        time.sleep(RETRY_DELAY_SECONDS)
    return 'invalid', key


def check_api_keys():
    """
    Reads keys from Redis and txt/allkeys.txt, checks their validity,
    and saves active keys to txt/add_keys.txt and invalid keys to txt/delete_keys.txt.
    """
    source_keys_file = 'txt/allkeys.txt'
    add_keys_file = 'txt/add_keys.txt'
    delete_keys_file = 'txt/delete_keys.txt'
    set_name = "GEMINI_API_KEY_SET"
    
    try:
        # 1. Get keys from Redis
        redis_keys: Set[str] = set(redis.smembers(set_name))
        print(f"Found {len(redis_keys)} keys in Redis set '{set_name}'.")
        print("Redis keys:\n" + "\n".join(sorted(redis_keys)) + "\n")

        #2. Get keys from allkeys.txt
        file_keys: Set[str] = set()
        try:
            with open(source_keys_file, 'r', encoding='utf-8') as f:
                file_keys = {line.strip() for line in f if line.strip()}
            print(f"Found {len(file_keys)} keys in '{source_keys_file}'.")
        except FileNotFoundError:
            print(f"'{source_keys_file}' not found. Continuing with Redis keys only.")

        # 3. Combine and deduplicate
        all_keys = list(redis_keys.union(file_keys))

        if not all_keys:
            print(f"No keys found in Redis or '{source_keys_file}' to check.")
            return

        key_count = len(all_keys)
        print(f"Found {key_count} unique keys in total. Starting validity check...")

        active_keys: List[str] = []
        invalid_keys: List[str] = []

        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_key = {executor.submit(_check_key_validity, key): key for key in all_keys}
            for future in tqdm(concurrent.futures.as_completed(future_to_key), total=key_count, desc="Checking Keys"):
                status, key = future.result()
                if status == 'active':
                    active_keys.append(key)
                else:
                    invalid_keys.append(key)

        print("\nCheck complete. Optimizing and sorting keys for Redis update...")

        # Filter keys for efficient updates
        keys_to_add = [key for key in active_keys if key not in redis_keys]
        keys_to_remove = [key for key in invalid_keys if key in redis_keys]

        # Write active keys that are NOT in Redis to add_keys.txt
        with open(add_keys_file, 'w', encoding='utf-8') as f:
            for key in sorted(keys_to_add):
                f.write(f"{key}\n")
        print(f"'{add_keys_file}' has been updated with {len(keys_to_add)} new active keys to be added.")

        # Write invalid keys that ARE in Redis to delete_keys.txt
        with open(delete_keys_file, 'w', encoding='utf-8') as f:
            for key in sorted(keys_to_remove):
                f.write(f"{key}\n")
        print(f"'{delete_keys_file}' has been updated with {len(keys_to_remove)} invalid keys to be removed.")

        # Print final summary
        print("\n" + "="*35)
        print("         Key Check Summary")
        print("="*35)
        print(f"Total unique keys checked: {key_count}")
        print(f"Total active keys found: {len(active_keys)}")
        print(f"Total invalid keys found: {len(invalid_keys)}")
        print("-" * 35)
        print(f"New active keys to add: {len(keys_to_add)}")
        print(f"Invalid keys to remove: {len(keys_to_remove)}")
        print("="*35)

        # --- Backup active keys ---
        final_keys = (redis_keys.union(set(keys_to_add))) - set(keys_to_remove)
        try:
            with open('txt/backend.txt', 'w', encoding='utf-8') as f:
                for key in sorted(list(final_keys)):
                    f.write(f"{key}\n")
            print(f"Successfully backed up {len(final_keys)} final valid keys to 'txt/backend.txt'.")
        except Exception as e:
            print(f"Error backing up keys to 'txt/backend.txt': {e}")


    except Exception as e:
        print(f"An error occurred during API key check: {e}")


def main_interactive():
    """Provides an interactive menu for the user to choose an action."""
    while True:
        print("\n请选择一个操作:")
        print("--- 授权密钥管理 ---")
        print("  1: 从 txt/add_auths.txt 逐个添加授权密钥并设置有效期")
        print("  2: 从 txt/delete_auths.txt 删除授权密钥")
        print("  3: 检查并清理过期的授权密钥")
        print("--- Gemini API 密钥管理 ---")
        print("  4: 从 txt/add_keys.txt 添加 API 密钥到 Redis")
        print("  5: 从 txt/delete_keys.txt 从 Redis 删除 API 密钥")
        print("  6: 对 txt/allkeys.txt 中的密钥进行去重")
        print("  7: 检查 Redis 和 allkeys.txt 中的密钥并将结果分类")
        print("--------------------")
        print("  q: 退出")

        choice = input("请输入您的选择: ")

        if choice == '1':
            add_auths()
        elif choice == '2':
            delete_auths()
        elif choice == '3':
            check_expired_auths()
        elif choice == '4':
            add_keys()
        elif choice == '5':
            delete_keys()
        elif choice == '6':
            deduplicate_keys()
        elif choice == '7':
            check_api_keys()
        elif choice.lower() == 'q':
            print("正在退出。")
            break
        else:
            print("无效的选择，请重试。")

if __name__ == "__main__":
    # If arguments are passed, use argparse for non-interactive mode
    if len(sys.argv) > 1:
        parser = argparse.ArgumentParser(description="Manage Redis sets and API keys.")
        subparsers = parser.add_subparsers(dest='action', required=True)

        # Sub-parser for add_auths
        subparsers.add_parser('add_auths', help="Add auth secrets interactively, setting an expiration for each.")

        # Sub-parsers for other actions
        subparsers.add_parser('delete_auths', help="Delete auth secrets.")
        subparsers.add_parser('check_expired_auths', help="Check and remove expired auth secrets.")
        subparsers.add_parser('add_keys', help="Add API keys.")
        subparsers.add_parser('delete_keys', help="Delete API keys.")
        subparsers.add_parser('deduplicate_keys', help="Deduplicate API keys in allkeys.txt.")
        subparsers.add_parser('check_api_keys', help="Check validity of API keys.")
        
        args = parser.parse_args()

        if args.action == 'add_auths':
            add_auths()
        elif args.action == 'delete_auths':
            delete_auths()
        elif args.action == 'check_expired_auths':
            check_expired_auths()
        elif args.action == 'add_keys':
            add_keys()
        elif args.action == 'delete_keys':
            delete_keys()
        elif args.action == 'deduplicate_keys':
            deduplicate_keys()
        elif args.action == 'check_api_keys':
            check_api_keys()
    else:
        # Otherwise, run in interactive mode
        main_interactive()
